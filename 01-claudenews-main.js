#!/usr/bin/env node

/**
 * ═════════════════════════════════════════════════════════════════
 *   Claude News Collector v5.0
 * ═════════════════════════════════════════════════════════════════
 *
 * 升级内容（vs v4）:
 *   ✓ 用 fast-xml-parser 替换正则RSS解析（处理Atom/CDATA/命名空间）
 *   ✓ 用 p-limit 控制并发（同域名最多2-3个并发）
 *   ✓ 用 AbortController 替代废弃的timeout
 *   ✓ 加重试机制（指数退避）
 *   ✓ 改进的相似度去重（jaccard + 标准化）
 *   ✓ 解析Google News重定向链接
 *   ✓ 时区统一为Asia/Shanghai
 *   ✓ 历史记录去重（持久化到 cache/history.json）
 *   ✓ 增量更新（只展示新内容）
 *   ✓ 7天自动清理历史
 *
 * 文件结构（单文件内分区清晰）:
 *   ┌── §1  常量配置
 *   ├── §2  工具层    (logger, time, text, fetch with retry)
 *   ├── §3  解析层    (XML/RSS, Google News URL decoder)
 *   ├── §4  缓存层    (history.json 读写)
 *   ├── §5  采集层    (9个数据源)
 *   ├── §6  处理层    (去重 / 过滤 / 排序 / 分组)
 *   ├── §7  渲染层    (HTML / Markdown)
 *   ├── §8  邮件层
 *   └── §9  主流程
 */

'use strict';

// ═════════════════════════════════════════════════════════════════
// §1 常量配置
// ═════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 尝试加载可选依赖（fast-xml-parser 和 p-limit）
let XMLParser, pLimit;
try {
  XMLParser = require('fast-xml-parser').XMLParser;
} catch (e) {
  console.warn('⚠️  fast-xml-parser 未安装，将使用降级RSS解析');
}
try {
  pLimit = require('p-limit');
  // p-limit v3 是 CommonJS，v4+是ESM。处理两种情况
  if (pLimit && pLimit.default) pLimit = pLimit.default;
} catch (e) {
  console.warn('⚠️  p-limit 未安装，将使用简单并发');
}

const CONFIG = {
  // 环境变量
  gmail: {
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
  },
  recipient: process.env.EMAIL_RECIPIENT || process.env.GMAIL_USER,
  
  // 时间窗口（天）
  daysToKeep: 7,
  
  // 历史记录天数（用于去重）
  historyDays: 14,
  
  // 缓存文件路径
  cacheDir: 'cache',
  historyFile: 'cache/history.json',
  
  // 网络配置
  defaultTimeout: 15000,
  maxRetries: 2,
  concurrency: 4,            // 同时并发请求数
  
  // 内容限制
  maxNewsItems: 50,           // 邮件中最多展示
  
  // 时区
  timezone: 'Asia/Shanghai',
};

// ═════════════════════════════════════════════════════════════════
// §2 工具层
// ═════════════════════════════════════════════════════════════════

// ─────────── §2.1 Logger ───────────
const logger = {
  section: (title) => console.log(`\n【${title}】`),
  info: (msg, indent = 1) => console.log('  '.repeat(indent) + msg),
  success: (msg, indent = 1) => console.log('  '.repeat(indent) + '✓ ' + msg),
  warn: (msg, indent = 1) => console.log('  '.repeat(indent) + '⚠️  ' + msg),
  error: (msg, indent = 1) => console.error('  '.repeat(indent) + '❌ ' + msg),
  divider: (char = '─', len = 50) => console.log(char.repeat(len)),
  banner: (title) => {
    const line = '═'.repeat(45);
    console.log('\n' + line);
    console.log(`  ${title}`);
    console.log(line + '\n');
  },
};

// ─────────── §2.2 时间工具 (统一时区) ───────────
const timeUtil = {
  // 北京时间的"今天0点"对应的UTC时间戳
  getTodayStart() {
    const now = new Date();
    // 转换到Asia/Shanghai
    const cnTime = new Date(now.toLocaleString('en-US', { timeZone: CONFIG.timezone }));
    cnTime.setHours(0, 0, 0, 0);
    return cnTime.getTime();
  },
  
  getCutoff(days) {
    return Date.now() - days * 86400000;
  },
  
  formatCN(date, opts = {}) {
    const d = new Date(date);
    return d.toLocaleString('zh-CN', { 
      timeZone: CONFIG.timezone, 
      ...opts 
    });
  },
  
  formatDate(date) {
    return this.formatCN(date, { year: 'numeric', month: '2-digit', day: '2-digit' });
  },
  
  formatDateTime(date) {
    return this.formatCN(date, { 
      month: '2-digit', day: '2-digit', 
      hour: '2-digit', minute: '2-digit' 
    });
  },
  
  isoDate(date = new Date()) {
    // 用Asia/Shanghai的日期作为ISO日期
    return new Intl.DateTimeFormat('sv-SE', { 
      timeZone: CONFIG.timezone 
    }).format(date);
  },
};

// ─────────── §2.3 文本工具 ───────────
const textUtil = {
  clean(text) {
    if (!text) return '';
    return String(text)
      .replace(/<[^>]+>/g, '')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(parseInt(num, 10)))
      .replace(/\s+/g, ' ')
      .trim();
  },
  
  escapeHtml(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  },
  
  // 文本标准化（用于相似度比较）
  normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, '')   // 去URL
      .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')  // 保留中英文字符
      .replace(/\s+/g, ' ')
      .trim();
  },
  
  // Jaccard相似度
  similarity(a, b) {
    const na = this.normalize(a);
    const nb = this.normalize(b);
    if (!na || !nb) return 0;
    
    // 取标准化后的字符二元组
    const ngrams = (s, n = 3) => {
      const set = new Set();
      for (let i = 0; i <= s.length - n; i++) set.add(s.slice(i, i + n));
      return set;
    };
    
    const A = ngrams(na);
    const B = ngrams(nb);
    if (A.size === 0 || B.size === 0) return 0;
    
    let intersection = 0;
    for (const x of A) if (B.has(x)) intersection++;
    
    return intersection / (A.size + B.size - intersection);
  },
  
  // 内容指纹（用于历史去重）
  fingerprint(item) {
    const key = this.normalize(item.title).slice(0, 100);
    return crypto.createHash('md5').update(key).digest('hex').slice(0, 12);
  },
  
  // URL规范化（去query参数中的tracking标签）
  cleanUrl(url) {
    if (!url) return '';
    try {
      const u = new URL(url);
      const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 
                              'utm_content', 'ref', 'fbclid', 'gclid', 'mc_cid', 'mc_eid'];
      trackingParams.forEach(p => u.searchParams.delete(p));
      return u.toString();
    } catch {
      return url;
    }
  },
  
  // 三态相关性：high=确信 Claude-AI / low=裸 claude（疑似人名）/ none=无关
  // 修「西方媒体含非 Claude 新闻」：裸 "Claude"（Claude Monet 等人名）不再当作命中。
  relevanceLevel(title, desc = '') {
    const text = `${title || ''} ${desc || ''}`;
    if (!text.trim()) return 'none';
    const lower = text.toLowerCase();
    const hasAnthropic = lower.includes('anthropic') || text.includes('安特罗匹克') || text.includes('安托罗匹克');
    const hasClaude    = lower.includes('claude')    || text.includes('克劳德');
    // AI 语境词：claude 须与其一共现，才算 Claude-AI 新闻（含产品版本号、API/模型/智能体等）
    const aiCtx = /(anthropic|\bai\b|llm|gpt|model|模型|chatbot|大模型|人工智能|对话|助手|assistant|agent|智能体|api|token|prompt|opus|sonnet|haiku|claude\s*[0-9])/i.test(text);
    if (hasAnthropic)       return 'high';   // anthropic 出现即确信
    if (hasClaude && aiCtx) return 'high';   // claude + AI 语境
    if (hasClaude)          return 'low';    // 裸 claude（疑似人名）
    return 'none';
  },

  // 背向兼容包装：默认放行 low（社区源用）；媒体源应显式判 relevanceLevel(...) === 'high'
  isRelevant(title, desc = '') {
    return this.relevanceLevel(title, desc) !== 'none';
  },
};

// ─────────── §2.4 HTTP工具 (含retry和timeout) ───────────
async function fetchWithRetry(url, options = {}) {
  const { 
    timeout = CONFIG.defaultTimeout, 
    retries = CONFIG.maxRetries,
    ...fetchOptions 
  } = options;
  
  let lastError;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ClaudeNewsBot/5.0)',
          ...fetchOptions.headers,
        },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        // 4xx不重试，5xx重试
        if (response.status >= 400 && response.status < 500) {
          throw new Error(`HTTP ${response.status}`);
        }
        throw new Error(`HTTP ${response.status}`);
      }
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      lastError = error;
      
      // 不重试4xx
      if (error.message.startsWith('HTTP 4')) throw error;
      
      // 还有重试次数
      if (attempt < retries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }
  
  throw lastError;
}

// ─────────── §2.5 并发控制 ───────────
function makeLimit(n) {
  if (pLimit) return pLimit(n);
  
  // p-limit 不可用时的降级实现
  let active = 0;
  const queue = [];
  
  const next = () => {
    if (active >= n || queue.length === 0) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => {
      active--;
      next();
    });
  };
  
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    next();
  });
}

// ═════════════════════════════════════════════════════════════════
// §3 解析层
// ═════════════════════════════════════════════════════════════════

// ─────────── §3.1 RSS/Atom 解析 ───────────
function parseRSS(xml) {
  if (XMLParser) {
    return parseRSSWithLib(xml);
  } else {
    return parseRSSWithRegex(xml);
  }
}

function parseRSSWithLib(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '__cdata',
    parseTagValue: true,
    trimValues: true,
  });
  
  let parsed;
  try {
    parsed = parser.parse(xml);
  } catch (e) {
    return [];
  }
  
  const items = [];
  
  // RSS 2.0: rss.channel.item
  const rssItems = parsed?.rss?.channel?.item;
  if (rssItems) {
    const arr = Array.isArray(rssItems) ? rssItems : [rssItems];
    arr.forEach(item => {
      items.push(normalizeRSSItem(item));
    });
  }
  
  // Atom: feed.entry
  const atomEntries = parsed?.feed?.entry;
  if (atomEntries) {
    const arr = Array.isArray(atomEntries) ? atomEntries : [atomEntries];
    arr.forEach(entry => {
      items.push(normalizeAtomEntry(entry));
    });
  }
  
  return items.filter(i => i.title);
}

function normalizeRSSItem(item) {
  const getText = (field) => {
    const v = item[field];
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (v.__cdata) return String(v.__cdata);
    if (v['#text']) return String(v['#text']);
    return String(v);
  };
  
  const title = textUtil.clean(getText('title'));
  let link = getText('link');
  if (typeof item.link === 'object' && item.link['@_href']) {
    link = item.link['@_href'];
  }
  const description = textUtil.clean(
    getText('description') || getText('content:encoded') || ''
  );
  const pubDate = getText('pubDate') || getText('dc:date') || '';
  
  return {
    title,
    link,
    description,
    pubDate: pubDate ? new Date(pubDate) : new Date(),
  };
}

function normalizeAtomEntry(entry) {
  const getText = (field) => {
    const v = entry[field];
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (v.__cdata) return String(v.__cdata);
    if (v['#text']) return String(v['#text']);
    return String(v);
  };
  
  const title = textUtil.clean(getText('title'));
  
  // Atom link 通常是属性
  let link = '';
  if (entry.link) {
    if (Array.isArray(entry.link)) {
      const alt = entry.link.find(l => !l['@_rel'] || l['@_rel'] === 'alternate');
      link = alt?.['@_href'] || entry.link[0]?.['@_href'] || '';
    } else if (typeof entry.link === 'object') {
      link = entry.link['@_href'] || '';
    } else {
      link = String(entry.link);
    }
  }
  
  const description = textUtil.clean(
    getText('summary') || getText('content') || ''
  );
  const pubDate = getText('published') || getText('updated') || '';
  
  return {
    title,
    link,
    description,
    pubDate: pubDate ? new Date(pubDate) : new Date(),
  };
}

// 降级方案：正则解析
function parseRSSWithRegex(xml) {
  const items = [];
  const itemPattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  
  while ((match = itemPattern.exec(xml)) !== null) {
    const itemXml = match[2];
    const title = extractTag(itemXml, 'title');
    const link = extractLink(itemXml);
    const description = extractTag(itemXml, 'description') 
                     || extractTag(itemXml, 'summary') 
                     || extractTag(itemXml, 'content');
    const pubDate = extractTag(itemXml, 'pubDate') 
                 || extractTag(itemXml, 'published') 
                 || extractTag(itemXml, 'updated');
    
    if (title) {
      items.push({
        title: textUtil.clean(title),
        link: link,
        description: textUtil.clean(description || ''),
        pubDate: pubDate ? new Date(pubDate) : new Date(),
      });
    }
  }
  
  return items;
}

function extractTag(xml, tag) {
  const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const normalPattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1].trim();
  
  const normalMatch = xml.match(normalPattern);
  if (normalMatch) return normalMatch[1].trim();
  
  return null;
}

function extractLink(xml) {
  const rssLink = extractTag(xml, 'link');
  if (rssLink && rssLink.startsWith('http')) return rssLink;
  
  const atomMatch = xml.match(/<link[^>]+href="([^"]+)"/i);
  if (atomMatch) return atomMatch[1];
  
  return '';
}

// ─────────── §3.2 Google News URL 解析 ───────────
function decodeGoogleNewsUrl(url) {
  if (!url || !url.includes('news.google.com')) return url;
  
  try {
    const u = new URL(url);
    // Google News 的真实URL在 url 参数里
    const realUrl = u.searchParams.get('url');
    if (realUrl) return realUrl;
    
    // 或者base64编码的articles路径
    // 暂时返回原URL，深度解码需要复杂逻辑
    return url;
  } catch {
    return url;
  }
}

// ═════════════════════════════════════════════════════════════════
// §4 缓存层 (历史记录持久化)
// ═════════════════════════════════════════════════════════════════

const cache = {
  data: {
    items: {},     // { fingerprint: { firstSeen, lastSeen, count } }
    lastRun: null,
  },
  
  // 读取历史
  load() {
    try {
      if (!fs.existsSync(CONFIG.cacheDir)) {
        fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
      }
      
      if (fs.existsSync(CONFIG.historyFile)) {
        const content = fs.readFileSync(CONFIG.historyFile, 'utf-8');
        this.data = JSON.parse(content);
        logger.success(`已加载历史记录: ${Object.keys(this.data.items || {}).length} 条`);
      } else {
        logger.info('首次运行，未找到历史记录');
        this.data = { items: {}, lastRun: null };
      }
    } catch (e) {
      logger.warn(`历史记录加载失败: ${e.message}，使用空历史`);
      this.data = { items: {}, lastRun: null };
    }
  },
  
  // 写入历史
  save() {
    try {
      if (!fs.existsSync(CONFIG.cacheDir)) {
        fs.mkdirSync(CONFIG.cacheDir, { recursive: true });
      }
      
      this.data.lastRun = new Date().toISOString();
      fs.writeFileSync(
        CONFIG.historyFile, 
        JSON.stringify(this.data, null, 2),
        'utf-8'
      );
      logger.success(`历史记录已保存: ${Object.keys(this.data.items).length} 条`);
    } catch (e) {
      logger.warn(`历史记录保存失败: ${e.message}`);
    }
  },
  
  // 检查是否已存在
  has(item) {
    const fp = textUtil.fingerprint(item);
    return !!this.data.items[fp];
  },
  
  // 添加到历史
  add(item) {
    const fp = textUtil.fingerprint(item);
    const now = Date.now();
    
    if (this.data.items[fp]) {
      this.data.items[fp].lastSeen = now;
      this.data.items[fp].count = (this.data.items[fp].count || 1) + 1;
    } else {
      this.data.items[fp] = {
        firstSeen: now,
        lastSeen: now,
        count: 1,
        title: item.title.slice(0, 100),
      };
    }
  },
  
  // 清理过期历史
  prune() {
    const cutoff = Date.now() - CONFIG.historyDays * 86400000;
    let pruned = 0;
    
    for (const [fp, info] of Object.entries(this.data.items)) {
      if ((info.lastSeen || info.firstSeen || 0) < cutoff) {
        delete this.data.items[fp];
        pruned++;
      }
    }
    
    if (pruned > 0) {
      logger.info(`清理了 ${pruned} 条过期历史 (${CONFIG.historyDays}天前)`);
    }
  },
};

// ═════════════════════════════════════════════════════════════════
// §5 采集层
// ═════════════════════════════════════════════════════════════════

const cutoffDate = timeUtil.getCutoff(CONFIG.daysToKeep);

// ─────────── §5.1 Hacker News ───────────
async function fetchHackerNews() {
  logger.info('📡 Hacker News...');
  try {
    const url = 'https://hn.algolia.com/api/v1/search_by_date?query=claude+anthropic&tags=story&numericFilters=created_at_i>'
              + Math.floor(cutoffDate / 1000);
    
    const response = await fetchWithRetry(url);
    const data = await response.json();
    const hits = data.hits || [];
    
    const news = [];
    hits.forEach(hit => {
      if (!hit.title || textUtil.relevanceLevel(hit.title, hit.story_text || '') !== 'high') return;
      news.push({
        title: String(hit.title),
        description: String(hit.title),
        link: textUtil.cleanUrl(hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`),
        source: 'Hacker News',
        publishedAt: new Date(hit.created_at),
        points: hit.points || 0,
        commentsCount: hit.num_comments || 0,
      });
    });
    
    logger.success(`${news.length} 条`, 2);
    return news;
  } catch (error) {
    logger.warn(error.message, 2);
    return [];
  }
}

// ─────────── §5.2 Reddit ───────────
async function fetchReddit() {
  logger.info('🔴 Reddit...');
  const news = [];
  
  for (const sub of ['ClaudeAI', 'Anthropic']) {
    try {
      const url = `https://old.reddit.com/r/${sub}/top.json?t=week&limit=15`;
      const response = await fetchWithRetry(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 ClaudeNewsBot/5.0' },
      });
      
      const data = await response.json();
      const posts = data?.data?.children || [];
      
      posts.forEach(post => {
        const p = post.data;
        if (!p || !p.title) return;
        const postDate = new Date((p.created_utc || 0) * 1000);
        if (postDate.getTime() < cutoffDate) return;
        if ((p.score || 0) < 5) return;
        
        news.push({
          title: String(p.title),
          description: String(p.selftext || p.title).substring(0, 300),
          link: textUtil.cleanUrl(`https://reddit.com${p.permalink}`),
          source: `Reddit r/${sub}`,
          publishedAt: postDate,
          points: p.score || 0,
          commentsCount: p.num_comments || 0,
        });
      });
    } catch (e) { /* 忽略单个失败 */ }
  }
  
  logger.success(`${news.length} 条`, 2);
  return news;
}

// ─────────── §5.3 GitHub ───────────
async function fetchGitHub() {
  logger.info('🐙 GitHub...');
  try {
    const since = timeUtil.isoDate(new Date(cutoffDate));
    const url = `https://api.github.com/search/repositories?q=claude+anthropic+pushed:>${since}&sort=stars&order=desc&per_page=10`;
    
    const response = await fetchWithRetry(url, {
      headers: { 
        'User-Agent': 'ClaudeNewsBot/5.0',
        'Accept': 'application/vnd.github.v3+json' 
      },
    });
    
    const data = await response.json();
    const news = (data.items || []).map(item => ({
      title: `[${item.full_name}] ${(item.description || '').substring(0, 100)}`,
      description: item.description || '',
      link: textUtil.cleanUrl(item.html_url),
      source: 'GitHub',
      publishedAt: new Date(item.pushed_at || item.updated_at),
      points: item.stargazers_count || 0,
    }));
    
    logger.success(`${news.length} 条`, 2);
    return news;
  } catch (error) {
    logger.warn(error.message, 2);
    return [];
  }
}

// ─────────── §5.4 Anthropic 官方 ───────────
async function fetchAnthropicNews() {
  logger.info('📰 Anthropic Official...');
  try {
    const response = await fetchWithRetry('https://www.anthropic.com/news', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    
    const html = await response.text();
    const linkPattern = /href="(\/news\/[^"]+)"[^>]*>([^<]+)</g;
    const seen = new Set();
    const news = [];
    let match;
    
    while ((match = linkPattern.exec(html)) !== null) {
      const [, urlPath, title] = match;
      const cleanTitle = title.trim();
      if (!cleanTitle || cleanTitle.length < 5 || cleanTitle.length > 200) continue;
      if (seen.has(urlPath)) continue;
      seen.add(urlPath);
      
      news.push({
        title: cleanTitle,
        description: cleanTitle,
        link: `https://www.anthropic.com${urlPath}`,
        source: 'Anthropic Official',
        publishedAt: new Date(),
        isOfficial: true,
      });
    }
    
    const result = news.slice(0, 8);
    logger.success(`${result.length} 条`, 2);
    return result;
  } catch (error) {
    logger.warn(error.message, 2);
    return [];
  }
}

// ─────────── §5.5 Google News (聚合西方主流) ───────────
async function fetchGoogleNews() {
  logger.info('🌍 Google News...');
  const news = [];
  
  const queries = [
    'Anthropic Claude',
    'Claude AI Anthropic',
  ];
  
  const limit = makeLimit(2);
  
  await Promise.allSettled(queries.map(q => limit(async () => {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:7d&hl=en-US&gl=US&ceid=US:en`;
      const response = await fetchWithRetry(url);
      const xml = await response.text();
      const items = parseRSS(xml);
      
      items.forEach(item => {
        if (textUtil.relevanceLevel(item.title, item.description || '') !== 'high') return;
        if (item.pubDate.getTime() < cutoffDate) return;
        
        // 标题中提取来源: "标题 - The New York Times"
        const sourceMatch = item.title.match(/ - ([^-]+)$/);
        const realSource = sourceMatch ? sourceMatch[1].trim() : 'Google News';
        const cleanTitle = item.title.replace(/ - [^-]+$/, '').trim();
        
        news.push({
          title: cleanTitle,
          description: item.description.substring(0, 300),
          link: decodeGoogleNewsUrl(item.link),
          source: realSource,
          publishedAt: item.pubDate,
          category: 'western_media',
        });
      });
    } catch (e) { /* 忽略 */ }
  })));
  
  // 同名去重
  const seen = new Set();
  const deduped = news.filter(item => {
    const key = textUtil.normalize(item.title).slice(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  logger.success(`${deduped.length} 条 (含NYT/WSJ/TechCrunch等)`, 2);
  return deduped;
}

// ─────────── §5.6 西方媒体 RSS ───────────
async function fetchWesternMediaRSS() {
  logger.info('🌐 西方媒体 RSS...');
  
  const feeds = [
    { url: 'https://techcrunch.com/feed/', source: 'TechCrunch' },
    { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge' },
    { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica' },
    { url: 'https://www.wired.com/feed/rss', source: 'Wired' },
    { url: 'https://www.technologyreview.com/feed/', source: 'MIT Tech Review' },
    { url: 'https://venturebeat.com/feed/', source: 'VentureBeat' },
  ];
  
  const news = [];
  const limit = makeLimit(CONFIG.concurrency);
  
  await Promise.allSettled(feeds.map(({ url, source }) => limit(async () => {
    try {
      const response = await fetchWithRetry(url, { timeout: 12000 });
      const xml = await response.text();
      const items = parseRSS(xml);
      
      items.forEach(item => {
        const text = `${item.title} ${item.description}`;
        if (textUtil.relevanceLevel(item.title, item.description) !== 'high') return;
        if (item.pubDate.getTime() < cutoffDate) return;
        
        news.push({
          title: item.title,
          description: item.description.substring(0, 300),
          link: textUtil.cleanUrl(item.link),
          source: source,
          publishedAt: item.pubDate,
          category: 'western_media',
        });
      });
    } catch (e) { /* 忽略 */ }
  })));
  
  logger.success(`${news.length} 条`, 2);
  return news;
}

// ─────────── §5.7 中文科技媒体 RSS ───────────
async function fetchChineseMediaRSS() {
  logger.info('🇨🇳 中文科技媒体 RSS...');
  
  const feeds = [
    { url: 'https://sspai.com/feed', source: '少数派' },
    { url: 'https://www.36kr.com/feed', source: '36氪' },
    { url: 'https://www.jiqizhixin.com/rss', source: '机器之心' },
    { url: 'https://www.qbitai.com/feed', source: '量子位' },
    { url: 'https://www.infoq.cn/feed.xml', source: 'InfoQ中文' },
  ];
  
  const news = [];
  const limit = makeLimit(CONFIG.concurrency);
  
  await Promise.allSettled(feeds.map(({ url, source }) => limit(async () => {
    try {
      const response = await fetchWithRetry(url, { timeout: 12000 });
      const xml = await response.text();
      const items = parseRSS(xml);
      
      items.forEach(item => {
        const text = `${item.title} ${item.description}`;
        if (textUtil.relevanceLevel(item.title, item.description) !== 'high') return;
        if (item.pubDate.getTime() < cutoffDate) return;
        
        news.push({
          title: item.title,
          description: item.description.substring(0, 300),
          link: textUtil.cleanUrl(item.link),
          source: source,
          publishedAt: item.pubDate,
          category: 'chinese_media',
        });
      });
    } catch (e) { /* 忽略 */ }
  })));
  
  logger.success(`${news.length} 条`, 2);
  return news;
}

// ─────────── §5.8 知乎 ───────────
async function fetchZhihu() {
  logger.info('💭 知乎...');
  const news = [];
  
  for (const q of ['Claude', 'Anthropic']) {
    try {
      const url = `https://www.zhihu.com/api/v4/search_v3?t=general&q=${encodeURIComponent(q)}&correction=1&offset=0&limit=10&time_interval=a_week`;
      const response = await fetchWithRetry(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
          'Accept': 'application/json',
          'Referer': 'https://www.zhihu.com/',
        },
      });
      
      const data = await response.json();
      const items = data.data || [];
      
      items.forEach(item => {
        const obj = item.object;
        if (!obj || !obj.title) return;
        
        const title = textUtil.clean(obj.title);
        if (!textUtil.isRelevant(title) && !textUtil.isRelevant(obj.excerpt || '')) return;
        
        const created = obj.created_time || obj.updated_time;
        if (created && created * 1000 < cutoffDate) return;
        
        let link = '';
        if (obj.type === 'answer') {
          link = `https://www.zhihu.com/question/${obj.question?.id}/answer/${obj.id}`;
        } else if (obj.type === 'article') {
          link = `https://zhuanlan.zhihu.com/p/${obj.id}`;
        } else if (obj.type === 'question') {
          link = `https://www.zhihu.com/question/${obj.id}`;
        }
        
        if (!link) return;
        
        news.push({
          title: title,
          description: textUtil.clean(obj.excerpt || '').substring(0, 300),
          link: textUtil.cleanUrl(link),
          source: `知乎 (${obj.type === 'answer' ? '回答' : obj.type === 'article' ? '文章' : '问题'})`,
          publishedAt: created ? new Date(created * 1000) : new Date(),
          points: obj.voteup_count || 0,
          commentsCount: obj.comment_count || 0,
          category: 'chinese_media',
        });
      });
    } catch (e) { /* 忽略 */ }
  }
  
  logger.success(`${news.length} 条`, 2);
  return news;
}

// ─────────── §5.9 搜狗微信 ───────────
async function fetchWeixin() {
  logger.info('💬 搜狗微信...');
  const news = [];
  
  for (const q of ['Anthropic Claude', 'Claude AI']) {
    try {
      const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(q)}&tsn=1&ie=utf8`;
      const response = await fetchWithRetry(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'zh-CN,zh;q=0.9',
        },
        retries: 0,  // 搜狗反爬不重试
      });
      
      const html = await response.text();
      const articlePattern = /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/g;
      
      let match;
      let count = 0;
      while ((match = articlePattern.exec(html)) !== null && count < 10) {
        const link = match[1].startsWith('http') ? match[1] : `https://weixin.sogou.com${match[1]}`;
        const title = textUtil.clean(match[2]);
        
        if (!title || !textUtil.isRelevant(title)) continue;
        
        news.push({
          title: title,
          description: title,
          link: link,
          source: '微信公众号 (搜狗)',
          publishedAt: new Date(),
          category: 'chinese_media',
        });
        count++;
      }
    } catch (e) { /* 忽略，搜狗经常失败 */ }
  }
  
  logger.success(`${news.length} 条 (搜狗反爬严格)`, 2);
  return news;
}

// ═════════════════════════════════════════════════════════════════
// §6 处理层
// ═════════════════════════════════════════════════════════════════

function processNews(rawItems) {
  logger.section('步骤3: 处理数据');
  
  // ─── §6.1 清洗 ───
  let items = rawItems.filter(i => i && i.title && i.title.length >= 5);
  logger.info(`原始 → 清洗后: ${rawItems.length} → ${items.length}`);
  
  // ─── §6.2 时间过滤 ───
  items = items.filter(item => {
    if (item.isOfficial) return true;
    return new Date(item.publishedAt).getTime() >= cutoffDate;
  });
  logger.info(`时间过滤: ${items.length} (最近${CONFIG.daysToKeep}天)`);

  // ─── §6.2.5 「元」分级 + 门禁（移植自修行项目 validate.py 的发送前门禁）───
  const beforeGate = items.length;
  items.forEach(enrichMeta);
  items = items.filter(it => {
    if (it.isOfficial) return true;             // 官方永不丢
    if (it.relevance === 'none') return false;  // ⚫ 无关 → 丢弃
    if (it.source_tier === '🟡' && !it.link) it.source_tier = '🔴'; // 🟡 缺出处 → 降级
    return true;
  });
  logger.info(`元门禁: ${beforeGate} → ${items.length}  [${tierBreakdown(items)}]`);
  RUN_STATS.gateInput = beforeGate;
  RUN_STATS.gateKept = items.length;

  // ─── §6.3 智能去重 (相似度) ───
  RUN_STATS.dedupBefore = items.length;
  items = dedupeBySimilarity(items, 0.75);
  RUN_STATS.dedupAfter = items.length;
  logger.info(`相似度去重: ${items.length}`);
  
  // ─── §6.4 历史去重 ───
  const fresh = [];
  const seen = [];
  
  items.forEach(item => {
    if (cache.has(item)) {
      seen.push(item);
    } else {
      fresh.push(item);
    }
    cache.add(item);   // 不管新旧都记录到历史
  });
  
  logger.info(`历史去重: ${items.length} → ${fresh.length} 新 + ${seen.length} 重复`);
  
  // 如果新内容太少（<5条），保留少量历史中的优质内容
  let result = fresh;
  if (fresh.length < 5 && seen.length > 0) {
    const topSeen = seen
      .filter(i => (i.points || 0) >= 10 || i.isOfficial)
      .slice(0, 5 - fresh.length);
    result = [...fresh, ...topSeen];
    logger.info(`新内容不足，补充 ${topSeen.length} 条优质历史`);
  }
  
  // ─── §6.5 排序 ───
  result.sort((a, b) => {
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
  
  // ─── §6.6 限制总数 ───
  if (result.length > CONFIG.maxNewsItems) {
    result = result.slice(0, CONFIG.maxNewsItems);
    logger.info(`限制总数: ${CONFIG.maxNewsItems}`);
  }
  
  logger.success(`最终保留: ${result.length} 条`);
  return result;
}

function dedupeBySimilarity(items, threshold) {
  const result = [];
  
  for (const item of items) {
    let isDuplicate = false;
    for (const existing of result) {
      if (textUtil.similarity(item.title, existing.title) >= threshold) {
        isDuplicate = true;
        // 多源同新闻：合并热度
        existing.points = (existing.points || 0) + (item.points || 0);
        break;
      }
    }
    if (!isDuplicate) result.push(item);
  }
  
  return result;
}

function groupByTime(news) {
  const groups = { today: [], yesterday: [], thisWeek: [], official: [] };
  const todayStart = timeUtil.getTodayStart();
  const yesterdayStart = todayStart - 86400000;
  
  news.forEach(item => {
    if (item.isOfficial) {
      groups.official.push(item);
      return;
    }
    const t = new Date(item.publishedAt).getTime();
    if (t >= todayStart) groups.today.push(item);
    else if (t >= yesterdayStart) groups.yesterday.push(item);
    else groups.thisWeek.push(item);
  });
  
  return groups;
}

// ═════════════════════════════════════════════════════════════════
// §7 渲染层
// ═════════════════════════════════════════════════════════════════

function getSourceIcon(source, category) {
  if (source === 'Anthropic Official') return '🌟';
  if (source === 'Hacker News') return '🟠';
  if (source.startsWith('Reddit')) return '🔴';
  if (source === 'GitHub') return '🐙';
  if (category === 'chinese_media') return '🇨🇳';
  if (category === 'western_media') return '🌍';
  return '📰';
}

function getBorderColor(item) {
  if (item.isOfficial) return '#f59e0b';
  if (item.category === 'chinese_media') return '#ef4444';
  if (item.category === 'western_media') return '#3b82f6';
  return '#667eea';
}

// ─────────── 「元」：来源分级 + 出处（移植自 mind-body-health 的 source_tier 纪律）───────────
const TIER_LABEL = { '🟢': '官方', '🟡': '权威媒体', '🔴': '社区/待核', '⚫': '未证实' };

// 监理：本次运行的统计，供每日 run-log 与每周复盘聚合
let RUN_STATS = { gateInput: 0, gateKept: 0, dedupBefore: 0, dedupAfter: 0 };

// 🟢官方 / 🟡权威媒体(high) / 🔴社区或弱相关 / ⚫无关
function assignTier(item) {
  if (item.isOfficial) return '🟢';
  const rel = item.relevance || textUtil.relevanceLevel(item.title, item.description || '');
  if (rel === 'none') return '⚫';
  if (rel === 'low')  return '🔴';                       // 裸 claude（疑似人名）
  if (item.category === 'western_media' || item.category === 'chinese_media') return '🟡';
  return '🔴';                                            // HN/Reddit/GitHub/知乎/微信 等社区
}

// 给条目补「元」字段：relevance / source_tier / provenance
function enrichMeta(item) {
  item.relevance = item.relevance || textUtil.relevanceLevel(item.title, item.description || '');
  item.source_tier = assignTier(item);
  item.provenance = { url: item.link || '', fetcher: item.source || '未知' };
  return item;
}

function tierBreakdown(items) {
  const c = {};
  items.forEach(i => { c[i.source_tier] = (c[i.source_tier] || 0) + 1; });
  return ['🟢', '🟡', '🔴', '⚫'].filter(t => c[t]).map(t => `${t}${c[t]}`).join(' ') || '—';
}

// ─────────── §7.1 HTML 渲染 ───────────
function renderItemHTML(item, idx) {
  const timeStr = timeUtil.formatDateTime(item.publishedAt);
  const icon = getSourceIcon(item.source, item.category);
  const borderColor = getBorderColor(item);
  const tier = item.source_tier || '⚫';
  const tierBadge = `<span style="font-size:11px;">${tier}${TIER_LABEL[tier] || ''}</span>`;
  const caution = (tier === '🔴' || tier === '⚫')
    ? ` <span style="color:#999;font-size:11px;">（${tier === '⚫' ? '未证实' : '社区来源'}，请自行核实）</span>` : '';

  return `
    <div style="border-left: 4px solid ${borderColor}; padding: 12px 15px; margin: 12px 0; background: #f9fafb; border-radius: 4px;">
      <h3 style="margin: 0 0 6px 0; color: #222; font-size: 14px; line-height: 1.4;">
        ${idx}. ${tierBadge} ${textUtil.escapeHtml(item.title)}
      </h3>
      <p style="margin: 4px 0; color: #666; font-size: 11px;">
        ${icon} <strong>${textUtil.escapeHtml(item.source)}</strong> · ${timeStr}
        ${item.points ? ` · 👍 ${item.points}` : ''}
        ${item.commentsCount ? ` · 💬 ${item.commentsCount}` : ''}${caution}
      </p>
      ${item.description && item.description !== item.title ? 
        `<p style="margin: 6px 0; color: #555; font-size: 12px; line-height: 1.5;">${textUtil.escapeHtml(String(item.description).substring(0, 180))}${item.description.length > 180 ? '...' : ''}</p>` : ''}
      ${item.link ? `<a href="${textUtil.escapeHtml(item.link)}" style="color: ${borderColor}; text-decoration: none; font-size: 12px;">→ 查看详情</a>` : ''}
    </div>`;
}

function renderHTML(news, groups) {
  const dateStr = timeUtil.formatDate(new Date());
  
  const renderSection = (title, color, items, idxStart) => {
    if (items.length === 0) return { html: '', nextIdx: idxStart };
    let html = `<h2 style="color: ${color}; font-size: 16px; margin: 20px 0 10px 0; border-bottom: 2px solid ${color}; padding-bottom: 5px;">${title} <span style="font-size: 12px; color: #999;">(${items.length})</span></h2>`;
    let idx = idxStart;
    items.forEach(item => {
      html += renderItemHTML(item, idx++);
    });
    return { html, nextIdx: idx };
  };
  
  let allHTML = '';
  let idx = 1;
  
  const sections = [
    { title: '🌟 Anthropic 官方', color: '#f59e0b', items: groups.official },
    { title: '📅 今天', color: '#10b981', items: groups.today },
    { title: '📆 昨天', color: '#3b82f6', items: groups.yesterday },
    { title: '📋 本周早些时候', color: '#6b7280', items: groups.thisWeek },
  ];
  
  for (const sec of sections) {
    const { html, nextIdx } = renderSection(sec.title, sec.color, sec.items, idx);
    allHTML += html;
    idx = nextIdx;
  }
  
  if (news.length === 0) {
    allHTML = '<p style="color: #999; padding: 20px; text-align: center;">今日暂无 Claude / Anthropic 相关新增动态</p>';
  }
  
  // 来源统计
  const sourceStats = {};
  news.forEach(item => {
    const key = item.category === 'western_media' ? '🌍 西方媒体'
              : item.category === 'chinese_media' ? '🇨🇳 中文媒体'
              : item.isOfficial ? '🌟 官方'
              : item.source.includes('Reddit') ? '🔴 Reddit'
              : item.source === 'Hacker News' ? '🟠 HN'
              : item.source === 'GitHub' ? '🐙 GitHub'
              : '📰 其他';
    sourceStats[key] = (sourceStats[key] || 0) + 1;
  });
  
  const statsHTML = Object.entries(sourceStats)
    .map(([k, v]) => `<span style="display: inline-block; margin: 3px 6px 3px 0; padding: 3px 8px; background: rgba(255,255,255,0.2); border-radius: 12px; font-size: 11px;">${k}: ${v}</span>`)
    .join('');
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Claude.ai 日报</title></head>
<body style="font-family: -apple-system, Arial, sans-serif; background: #f5f5f5; padding: 20px; margin: 0;">
  <div style="max-width: 720px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 35px 30px;">
      <h1 style="margin: 0; font-size: 26px;">📰 Claude.ai 日报</h1>
      <p style="margin: 10px 0 8px 0; opacity: 0.95; font-size: 13px;">
        ${dateStr} · ${news.length} 条 (已自动去除历史推送)
      </p>
      <div style="margin-top: 8px;">${statsHTML}</div>
    </div>
    <div style="padding: 25px 30px;">${allHTML}</div>
    <div style="background: #f9fafb; padding: 15px; text-align: center; font-size: 11px; color: #999;">
      由 GitHub Actions 自动生成 · 每天 11:58 北京时间 · v5.0
    </div>
  </div>
</body>
</html>`;
}

// ─────────── §7.2 Markdown 渲染 ───────────
function renderMarkdown(news, groups) {
  const date = new Date();
  const dateStr = timeUtil.isoDate(date);
  
  let md = `---
tags:
  - claude
  - ai
  - news
  - automated
date: ${dateStr}
title: "Claude.ai 日报 - ${dateStr}"
---

# Claude.ai 日报 - ${dateStr}

> 生成时间: ${timeUtil.formatCN(date)}
> 总更新数: ${news.length} (最近 ${CONFIG.daysToKeep} 天, 已去除历史推送)

`;
  
  const renderSection = (title, items, idxStart) => {
    if (items.length === 0) return { md: '', nextIdx: idxStart };
    let s = `\n## ${title} (${items.length})\n\n`;
    let idx = idxStart;
    items.forEach(item => {
      const timeStr = timeUtil.formatCN(item.publishedAt);
      const icon = getSourceIcon(item.source, item.category);
      const tier = item.source_tier || '⚫';
      s += `### ${idx}. ${tier} ${item.title}\n\n`;
      s += `- **可信度**: ${tier} ${TIER_LABEL[tier] || ''}${(tier === '🔴' || tier === '⚫') ? '（请自行核实）' : ''}\n`;
      s += `- **来源**: ${icon} ${item.source}\n`;
      s += `- **时间**: ${timeStr}\n`;
      if (item.points) s += `- **热度**: 👍 ${item.points}${item.commentsCount ? ` · 💬 ${item.commentsCount}` : ''}\n`;
      if (item.link) s += `- **链接**: ${item.link}\n`;
      if (item.description && item.description !== item.title) {
        s += `\n${String(item.description).substring(0, 500)}\n`;
      }
      s += '\n---\n\n';
      idx++;
    });
    return { md: s, nextIdx: idx };
  };
  
  let idx = 1;
  const sections = [
    { title: '🌟 Anthropic 官方', items: groups.official },
    { title: '📅 今天', items: groups.today },
    { title: '📆 昨天', items: groups.yesterday },
    { title: '📋 本周早些时候', items: groups.thisWeek },
  ];
  
  for (const sec of sections) {
    const result = renderSection(sec.title, sec.items, idx);
    md += result.md;
    idx = result.nextIdx;
  }
  
  if (news.length === 0) md += '\n今日暂无新增更新（历史已推送的内容自动过滤）。\n';
  
  return md;
}

// ═════════════════════════════════════════════════════════════════
// §8 邮件层
// ═════════════════════════════════════════════════════════════════

async function sendEmail(news, html, markdown) {
  logger.section('步骤5: 发送邮件');
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: CONFIG.gmail.user, pass: CONFIG.gmail.appPassword },
  });
  
  await transporter.verify();
  logger.success('SMTP 连接成功');
  
  const date = new Date();
  const subjectDate = timeUtil.formatCN(date, { month: '2-digit', day: '2-digit' });
  const fileDate = timeUtil.isoDate(date);
  
  const result = await transporter.sendMail({
    from: CONFIG.gmail.user,
    to: CONFIG.recipient,
    subject: `Claude.ai 日报 - ${subjectDate} (${news.length} 条)`,
    html: html,
    attachments: [{
      filename: `claude-news-${fileDate}.md`,
      content: markdown,
      contentType: 'text/markdown; charset=utf-8',
    }],
  });
  
  logger.success('邮件已发送!');
  logger.info(`消息ID: ${result.messageId}`, 2);
  logger.info(`收件人: ${CONFIG.recipient}`, 2);
}

// ═════════════════════════════════════════════════════════════════
// §9 主流程
// ═════════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();
  
  logger.banner('Claude News Collector v5.0');
  
  // ─── 步骤1: 环境检查 ───
  logger.section('步骤1: 环境检查');
  logger.info(`GMAIL_USER: ${CONFIG.gmail.user ? '✓' : '❌'}`);
  logger.info(`GMAIL_APP_PASSWORD: ${CONFIG.gmail.appPassword ? '✓' : '❌'}`);
  logger.info(`时间窗口: 最近 ${CONFIG.daysToKeep} 天 (历史去重 ${CONFIG.historyDays} 天)`);
  logger.info(`fast-xml-parser: ${XMLParser ? '✓' : '⚠️ 用降级方案'}`);
  logger.info(`p-limit: ${pLimit ? '✓' : '⚠️ 用降级方案'}`);
  
  if (!CONFIG.gmail.user || !CONFIG.gmail.appPassword) {
    logger.error('缺少必要的环境变量');
    process.exit(1);
  }
  
  // ─── 加载历史 ───
  cache.load();
  cache.prune();
  
  // ─── 步骤2: 采集 ───
  logger.section('步骤2: 并行采集 9 个数据源');
  
  const results = await Promise.allSettled([
    fetchHackerNews(),
    fetchReddit(),
    fetchGitHub(),
    fetchAnthropicNews(),
    fetchGoogleNews(),
    fetchWesternMediaRSS(),
    fetchChineseMediaRSS(),
    fetchZhihu(),
    fetchWeixin(),
  ]);
  
  let allNews = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allNews = allNews.concat(r.value);
    }
  });
  
  logger.info(`\n  📊 9源共: ${allNews.length} 条原始数据`);
  
  // ─── 步骤3: 处理 ───
  const news = processNews(allNews);
  const groups = groupByTime(news);
  
  // ─── 步骤4: 渲染 ───
  logger.section('步骤4: 生成邮件');
  logger.info(`🌟 官方: ${groups.official.length} 条`);
  logger.info(`📅 今天: ${groups.today.length} 条`);
  logger.info(`📆 昨天: ${groups.yesterday.length} 条`);
  logger.info(`📋 本周早些时候: ${groups.thisWeek.length} 条`);
  
  const html = renderHTML(news, groups);
  const markdown = renderMarkdown(news, groups);
  
  // ─── 步骤5: 发送邮件 ───
  await sendEmail(news, html, markdown);

  // ─── 步骤5.1: 成功送达标记（仅发送成功后写入）───
  // 供 schedule 兜底判断「今天是否已由外部精准触发发过」，避免同日双发。
  try {
    require('fs').writeFileSync('.last-sent', timeUtil.isoDate(new Date()) + '\n');
  } catch (e) { logger.info('写 .last-sent 失败: ' + e.message, 2); }

  // ─── 步骤5.2: 监理日志（每日一行，供 weekly-review.js 聚合）───
  try {
    const by_source = {}, by_tier = {};
    news.forEach(i => {
      by_source[i.source] = (by_source[i.source] || 0) + 1;
      by_tier[i.source_tier] = (by_tier[i.source_tier] || 0) + 1;
    });
    const line = JSON.stringify({
      date: timeUtil.isoDate(new Date()),
      sent_at: new Date().toISOString(),
      total: news.length,
      by_tier,
      by_source,
      gate: { input: RUN_STATS.gateInput, kept: RUN_STATS.gateKept, dropped: RUN_STATS.gateInput - RUN_STATS.gateKept },
      dedup: { before: RUN_STATS.dedupBefore, after: RUN_STATS.dedupAfter },
    });
    require('fs').appendFileSync('cache/run-log.jsonl', line + '\n');
  } catch (e) { logger.info('写 run-log 失败: ' + e.message, 2); }

  // ─── 步骤6: 保存历史 ───
  logger.section('步骤6: 保存历史');
  cache.save();
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  logger.banner(`✅ 全部完成! (耗时 ${duration}s)`);
}

// 异常捕获
process.on('unhandledRejection', err => {
  console.error('\n未处理的Promise拒绝:', err);
  process.exit(1);
});

process.on('uncaughtException', err => {
  console.error('\n未捕获异常:', err);
  process.exit(1);
});

// 仅作为入口直接运行时才执行主流程；被 require 导入（如测试）时只导出工具，不发邮件。
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('\n❌ 执行失败:', err.message);
      console.error(err.stack);
      process.exit(1);
    });
}

module.exports = {
  textUtil, assignTier, enrichMeta, tierBreakdown, TIER_LABEL, renderItemHTML,
  // —— 采集函数（供 engine 的 Source 元复用；仅 require 时使用，不影响发邮件主流程）——
  fetchHackerNews, fetchReddit, fetchGitHub, fetchAnthropicNews, fetchGoogleNews,
  fetchWesternMediaRSS, fetchChineseMediaRSS, fetchZhihu, fetchWeixin,
  // —— 处理/渲染/发信/缓存（供 engine 复用，保证与 live 主流程同一套逻辑）——
  processNews, groupByTime, renderHTML, renderMarkdown, sendEmail, cache,
};
