#!/usr/bin/env node

/**
 * Claude News Collector v4.0
 * 改进:
 * - 新增 Google News RSS (覆盖所有主流英文媒体)
 * - 新增 主流媒体官方 RSS (TechCrunch, The Verge, Ars Technica等)
 * - 新增 中文科技媒体 RSS (机器之心, 36氪, 少数派, 量子位, InfoQ)
 * - 新增 知乎话题 API (Claude/Anthropic)
 * - 新增 搜狗微信搜索 (微信公众号文章)
 * - 保持时间分组（今天/昨天/本周早些时候）
 */

console.log('\n═══════════════════════════════════════════');
console.log('  Claude News Collector v4.0');
console.log('═══════════════════════════════════════════\n');

const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 配置
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const EMAIL_RECIPIENT = process.env.EMAIL_RECIPIENT || GMAIL_USER;

const DAYS_TO_KEEP = 7;
const cutoffDate = Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000;
const todayDate = new Date().setHours(0, 0, 0, 0);

console.log('【步骤1】环境检查...');
console.log(`  GMAIL_USER: ${GMAIL_USER ? '✓' : '❌'}`);
console.log(`  GMAIL_APP_PASSWORD: ${GMAIL_APP_PASSWORD ? '✓' : '❌'}`);
console.log(`  时间窗口: 最近 ${DAYS_TO_KEEP} 天\n`);

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('❌ 缺少必要的环境变量');
  process.exit(1);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 通用 RSS 解析器 (不依赖 rss-parser 库)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchRSS(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': options.userAgent || 'Mozilla/5.0 (compatible; ClaudeNewsBot/4.0)',
      ...options.headers,
    },
    timeout: options.timeout || 15000,
  });
  
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  
  const xml = await response.text();
  return parseRSS(xml);
}

function parseRSS(xml) {
  const items = [];
  
  // 同时支持 RSS 2.0 (<item>) 和 Atom (<entry>)
  const itemPattern = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  
  while ((match = itemPattern.exec(xml)) !== null) {
    const itemXml = match[2];
    
    const title = extractTag(itemXml, 'title');
    const link = extractLink(itemXml);
    const description = extractTag(itemXml, 'description') || extractTag(itemXml, 'summary') || extractTag(itemXml, 'content');
    const pubDate = extractTag(itemXml, 'pubDate') || extractTag(itemXml, 'published') || extractTag(itemXml, 'updated');
    
    if (title) {
      items.push({
        title: cleanText(title),
        link: link,
        description: cleanText(description || ''),
        pubDate: pubDate ? new Date(pubDate) : new Date(),
      });
    }
  }
  
  return items;
}

function extractTag(xml, tag) {
  // 处理 CDATA 和普通文本
  const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]><\\/${tag}>`, 'i');
  const normalPattern = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  
  const cdataMatch = xml.match(cdataPattern);
  if (cdataMatch) return cdataMatch[1].trim();
  
  const normalMatch = xml.match(normalPattern);
  if (normalMatch) return normalMatch[1].trim();
  
  return null;
}

function extractLink(xml) {
  // RSS 2.0: <link>url</link>
  const rssLink = extractTag(xml, 'link');
  if (rssLink && rssLink.startsWith('http')) return rssLink;
  
  // Atom: <link href="url" />
  const atomMatch = xml.match(/<link[^>]+href="([^"]+)"/i);
  if (atomMatch) return atomMatch[1];
  
  return '';
}

function cleanText(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]+>/g, '')          // 去除HTML标签
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 判断是否包含 Claude/Anthropic 关键词
function isRelevant(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return lower.includes('claude') || lower.includes('anthropic') || 
         text.includes('克劳德') || text.includes('安特罗匹克') || 
         text.includes('安托罗匹克') || text.includes('Anthropic');
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源1: Hacker News
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchHackerNews() {
  console.log('  📡 Hacker News...');
  try {
    const url = 'https://hn.algolia.com/api/v1/search_by_date?query=claude+anthropic&tags=story&numericFilters=created_at_i>' 
                + Math.floor(cutoffDate / 1000);
    
    const response = await fetch(url, { timeout: 15000 });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const hits = data.hits || [];
    
    const news = [];
    hits.forEach(hit => {
      if (!hit.title || !isRelevant(hit.title)) return;
      
      news.push({
        title: String(hit.title),
        description: String(hit.title),
        link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: 'Hacker News',
        publishedAt: new Date(hit.created_at),
        points: hit.points || 0,
        commentsCount: hit.num_comments || 0,
      });
    });
    
    console.log(`      ✓ ${news.length} 条`);
    return news;
  } catch (error) {
    console.log(`      ⚠️  ${error.message}`);
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源2: Reddit
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchReddit() {
  console.log('  🔴 Reddit...');
  const news = [];
  
  for (const sub of ['ClaudeAI', 'Anthropic']) {
    try {
      const url = `https://old.reddit.com/r/${sub}/top.json?t=week&limit=15`;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 ClaudeNewsBot/4.0' },
        timeout: 15000,
      });
      
      if (!response.ok) continue;
      
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
          link: `https://reddit.com${p.permalink}`,
          source: `Reddit r/${sub}`,
          publishedAt: postDate,
          points: p.score || 0,
          commentsCount: p.num_comments || 0,
        });
      });
    } catch (e) { /* 忽略 */ }
  }
  
  console.log(`      ✓ ${news.length} 条`);
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源3: GitHub
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchGitHub() {
  console.log('  🐙 GitHub...');
  try {
    const since = new Date(cutoffDate).toISOString().split('T')[0];
    const url = `https://api.github.com/search/repositories?q=claude+anthropic+pushed:>${since}&sort=stars&order=desc&per_page=10`;
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ClaudeNewsBot/4.0', 'Accept': 'application/vnd.github.v3+json' },
      timeout: 15000,
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const news = (data.items || []).map(item => ({
      title: `[${item.full_name}] ${(item.description || '').substring(0, 100)}`,
      description: item.description || '',
      link: item.html_url,
      source: 'GitHub',
      publishedAt: new Date(item.pushed_at || item.updated_at),
      points: item.stargazers_count || 0,
    }));
    
    console.log(`      ✓ ${news.length} 条`);
    return news;
  } catch (error) {
    console.log(`      ⚠️  ${error.message}`);
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源4: Anthropic 官方
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchAnthropicNews() {
  console.log('  📰 Anthropic Official...');
  try {
    const response = await fetch('https://www.anthropic.com/news', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 15000,
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const linkPattern = /href="(\/news\/[^"]+)"[^>]*>([^<]+)</g;
    const seen = new Set();
    const news = [];
    let match;
    
    while ((match = linkPattern.exec(html)) !== null) {
      const [, path, title] = match;
      const cleanTitle = title.trim();
      if (!cleanTitle || cleanTitle.length < 5 || cleanTitle.length > 200) continue;
      if (seen.has(path)) continue;
      seen.add(path);
      
      news.push({
        title: cleanTitle,
        description: cleanTitle,
        link: `https://www.anthropic.com${path}`,
        source: 'Anthropic Official',
        publishedAt: new Date(),
        isOfficial: true,
      });
    }
    
    const result = news.slice(0, 8);
    console.log(`      ✓ ${result.length} 条`);
    return result;
  } catch (error) {
    console.log(`      ⚠️  ${error.message}`);
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源5: Google News (聚合所有西方主流媒体)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchGoogleNews() {
  console.log('  🌍 Google News (西方主流媒体)...');
  const news = [];
  
  const queries = [
    { q: 'Anthropic Claude', lang: 'en-US', region: 'US' },
    { q: 'Claude AI Anthropic', lang: 'en-US', region: 'US' },
  ];
  
  for (const { q, lang, region } of queries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}+when:7d&hl=${lang}&gl=${region}&ceid=${region}:${lang.split('-')[0]}`;
      const items = await fetchRSS(url);
      
      items.forEach(item => {
        if (!isRelevant(item.title)) return;
        if (item.pubDate.getTime() < cutoffDate) return;
        
        // Google News 的链接是重定向链接，提取真实来源
        const sourceMatch = item.title.match(/ - ([^-]+)$/);
        const realSource = sourceMatch ? sourceMatch[1].trim() : 'Google News';
        const cleanTitle = item.title.replace(/ - [^-]+$/, '').trim();
        
        news.push({
          title: cleanTitle,
          description: item.description.substring(0, 300),
          link: item.link,
          source: `${realSource}`,
          publishedAt: item.pubDate,
          category: 'western_media',
        });
      });
    } catch (e) {
      console.log(`      ⚠️  Google News (${q}): ${e.message}`);
    }
  }
  
  // 去重
  const seen = new Set();
  const deduped = news.filter(item => {
    const key = item.title.toLowerCase().substring(0, 60);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  
  console.log(`      ✓ ${deduped.length} 条 (来自纽约时报/WSJ/TechCrunch等)`);
  return deduped;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源6: 西方主流媒体官方 RSS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchWesternMediaRSS() {
  console.log('  🌐 西方媒体官方 RSS...');
  const news = [];
  
  const feeds = [
    { url: 'https://techcrunch.com/feed/', source: 'TechCrunch' },
    { url: 'https://www.theverge.com/rss/index.xml', source: 'The Verge' },
    { url: 'https://feeds.arstechnica.com/arstechnica/index', source: 'Ars Technica' },
    { url: 'https://www.wired.com/feed/rss', source: 'Wired' },
    { url: 'https://www.technologyreview.com/feed/', source: 'MIT Tech Review' },
    { url: 'https://venturebeat.com/feed/', source: 'VentureBeat' },
  ];
  
  await Promise.allSettled(feeds.map(async ({ url, source }) => {
    try {
      const items = await fetchRSS(url, { timeout: 12000 });
      items.forEach(item => {
        if (!isRelevant(item.title) && !isRelevant(item.description)) return;
        if (item.pubDate.getTime() < cutoffDate) return;
        
        news.push({
          title: item.title,
          description: item.description.substring(0, 300),
          link: item.link,
          source: source,
          publishedAt: item.pubDate,
          category: 'western_media',
        });
      });
    } catch (e) { /* 忽略单个源失败 */ }
  }));
  
  console.log(`      ✓ ${news.length} 条`);
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源7: 中文科技媒体 RSS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchChineseMediaRSS() {
  console.log('  🇨🇳 中文科技媒体 RSS...');
  const news = [];
  
  const feeds = [
    { url: 'https://sspai.com/feed', source: '少数派' },
    { url: 'https://www.36kr.com/feed', source: '36氪' },
    { url: 'https://www.jiqizhixin.com/rss', source: '机器之心' },
    { url: 'https://www.qbitai.com/feed', source: '量子位' },
    { url: 'https://www.infoq.cn/feed.xml', source: 'InfoQ中文' },
    { url: 'https://rsshub.app/aifeng/news', source: 'AI风向标' },  // 备选
  ];
  
  await Promise.allSettled(feeds.map(async ({ url, source }) => {
    try {
      const items = await fetchRSS(url, { timeout: 12000 });
      items.forEach(item => {
        if (!isRelevant(item.title) && !isRelevant(item.description)) return;
        if (item.pubDate.getTime() < cutoffDate) return;
        
        news.push({
          title: item.title,
          description: item.description.substring(0, 300),
          link: item.link,
          source: source,
          publishedAt: item.pubDate,
          category: 'chinese_media',
        });
      });
    } catch (e) { /* 忽略单个源失败 */ }
  }));
  
  console.log(`      ✓ ${news.length} 条`);
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源8: 知乎话题
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchZhihu() {
  console.log('  💭 知乎...');
  const news = [];
  
  try {
    // 知乎搜索API
    const queries = ['Claude', 'Anthropic'];
    
    for (const q of queries) {
      try {
        const url = `https://www.zhihu.com/api/v4/search_v3?t=general&q=${encodeURIComponent(q)}&correction=1&offset=0&limit=10&filter_fields=&lc_idx=0&show_all_topics=0&search_source=Filter&time_interval=a_week`;
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
            'Accept': 'application/json',
            'Referer': 'https://www.zhihu.com/',
          },
          timeout: 15000,
        });
        
        if (!response.ok) continue;
        
        const data = await response.json();
        const items = data.data || [];
        
        items.forEach(item => {
          const obj = item.object;
          if (!obj || !obj.title) return;
          
          const title = cleanText(obj.title);
          if (!isRelevant(title) && !isRelevant(obj.excerpt || '')) return;
          
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
          
          news.push({
            title: title,
            description: cleanText(obj.excerpt || '').substring(0, 300),
            link: link || `https://www.zhihu.com/search?q=${encodeURIComponent(title)}`,
            source: `知乎 (${obj.type === 'answer' ? '回答' : obj.type === 'article' ? '文章' : '问题'})`,
            publishedAt: created ? new Date(created * 1000) : new Date(),
            points: obj.voteup_count || 0,
            commentsCount: obj.comment_count || 0,
            category: 'chinese_media',
          });
        });
      } catch (e) { /* 忽略 */ }
    }
    
    console.log(`      ✓ ${news.length} 条`);
  } catch (error) {
    console.log(`      ⚠️  ${error.message}`);
  }
  
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源9: 搜狗微信搜索
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchWeixin() {
  console.log('  💬 搜狗微信...');
  const news = [];
  
  try {
    const queries = ['Anthropic Claude', 'Claude AI'];
    
    for (const q of queries) {
      try {
        // 搜狗微信搜索 (按时间排序)
        const url = `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(q)}&tsn=1&ie=utf8`;
        
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'zh-CN,zh;q=0.9',
          },
          timeout: 15000,
        });
        
        if (!response.ok) {
          console.log(`      ⚠️  搜狗微信(${q}): HTTP ${response.status}`);
          continue;
        }
        
        const html = await response.text();
        
        // 提取微信文章 (搜狗的HTML结构)
        // <h3><a ... href="..." ...>标题</a></h3>
        const articlePattern = /<h3[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h3>/g;
        const datePattern = /<span[^>]*class="s2"[^>]*>([^<]+)</g;
        const authorPattern = /<a[^>]+id="account_name_\d+"[^>]*>([^<]+)</g;
        
        let match;
        let count = 0;
        const articles = [];
        
        while ((match = articlePattern.exec(html)) !== null && count < 10) {
          const link = match[1].startsWith('http') ? match[1] : `https://weixin.sogou.com${match[1]}`;
          const title = cleanText(match[2]);
          
          if (!title || !isRelevant(title)) continue;
          
          articles.push({ link, title });
          count++;
        }
        
        articles.forEach(art => {
          news.push({
            title: art.title,
            description: art.title,
            link: art.link,
            source: '微信公众号 (搜狗)',
            publishedAt: new Date(),  // 搜狗的时间不太准，用当前时间
            category: 'chinese_media',
          });
        });
      } catch (e) {
        console.log(`      ⚠️  搜狗微信(${q}): ${e.message}`);
      }
    }
    
    console.log(`      ✓ ${news.length} 条 (微信反爬严格，结果可能为0)`);
  } catch (error) {
    console.log(`      ⚠️  ${error.message}`);
  }
  
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 过滤和去重
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function filterAndDedupe(items) {
  console.log('\n【步骤3】过滤和去重...');
  console.log(`  原始数据: ${items.length} 条`);
  
  let filtered = items.filter(item => item && item.title && item.title.length > 5);
  console.log(`  有效数据: ${filtered.length} 条`);
  
  filtered = filtered.filter(item => {
    if (item.isOfficial) return true;
    return new Date(item.publishedAt).getTime() >= cutoffDate;
  });
  console.log(`  时间过滤后: ${filtered.length} 条`);
  
  const seen = new Set();
  filtered = filtered.filter(item => {
    const key = item.title.toLowerCase().substring(0, 60).replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`  去重后: ${filtered.length} 条`);
  
  filtered.sort((a, b) => {
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
  
  filtered = filtered.slice(0, 50);  // V4 允许更多条目
  console.log(`  最终保留: ${filtered.length} 条\n`);
  
  return filtered;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 时间分组
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function groupByTime(news) {
  const groups = { today: [], yesterday: [], thisWeek: [], official: [] };
  const yesterday = todayDate - 24 * 60 * 60 * 1000;
  
  news.forEach(item => {
    if (item.isOfficial) { groups.official.push(item); return; }
    const t = new Date(item.publishedAt).getTime();
    if (t >= todayDate) groups.today.push(item);
    else if (t >= yesterday) groups.yesterday.push(item);
    else groups.thisWeek.push(item);
  });
  
  return groups;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生成邮件 (保持时间分组)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// 给来源加上图标方便区分
function getSourceIcon(source, category) {
  if (source === 'Anthropic Official') return '🌟';
  if (source === 'Hacker News') return '🟠';
  if (source.startsWith('Reddit')) return '🔴';
  if (source === 'GitHub') return '🐙';
  if (category === 'chinese_media') return '🇨🇳';
  if (category === 'western_media') return '🌍';
  return '📰';
}

function renderItem(item, idx) {
  const timeStr = new Date(item.publishedAt).toLocaleString('zh-CN', { 
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
  });
  
  const icon = getSourceIcon(item.source, item.category);
  const borderColor = item.isOfficial ? '#f59e0b' 
                    : item.category === 'chinese_media' ? '#ef4444'
                    : item.category === 'western_media' ? '#3b82f6'
                    : '#667eea';
  
  return `
    <div style="border-left: 4px solid ${borderColor}; padding: 12px 15px; margin: 12px 0; background: #f9fafb; border-radius: 4px;">
      <h3 style="margin: 0 0 6px 0; color: #222; font-size: 14px; line-height: 1.4;">
        ${idx}. ${escapeHtml(item.title)}
      </h3>
      <p style="margin: 4px 0; color: #666; font-size: 11px;">
        ${icon} <strong>${escapeHtml(item.source)}</strong> · ${timeStr}
        ${item.points ? ` · 👍 ${item.points}` : ''}
        ${item.commentsCount ? ` · 💬 ${item.commentsCount}` : ''}
      </p>
      ${item.description && item.description !== item.title ? 
        `<p style="margin: 6px 0; color: #555; font-size: 12px; line-height: 1.5;">${escapeHtml(String(item.description).substring(0, 180))}${item.description.length > 180 ? '...' : ''}</p>` : ''}
      ${item.link ? `<a href="${escapeHtml(item.link)}" style="color: ${borderColor}; text-decoration: none; font-size: 12px;">→ 查看详情</a>` : ''}
    </div>`;
}

function generateHTML(news, groups) {
  const date = new Date();
  const dateStr = date.toLocaleDateString('zh-CN');
  
  let sectionsHTML = '';
  let idx = 1;
  
  const renderSection = (title, color, items) => {
    if (items.length === 0) return '';
    let s = `<h2 style="color: ${color}; font-size: 16px; margin: 20px 0 10px 0; border-bottom: 2px solid ${color}; padding-bottom: 5px;">${title} <span style="font-size: 12px; color: #999;">(${items.length})</span></h2>`;
    items.forEach(item => s += renderItem(item, idx++));
    return s;
  };
  
  sectionsHTML += renderSection('🌟 Anthropic 官方', '#f59e0b', groups.official);
  sectionsHTML += renderSection('📅 今天', '#10b981', groups.today);
  sectionsHTML += renderSection('📆 昨天', '#3b82f6', groups.yesterday);
  sectionsHTML += renderSection('📋 本周早些时候', '#6b7280', groups.thisWeek);
  
  if (news.length === 0) {
    sectionsHTML = '<p style="color: #999; padding: 20px; text-align: center;">今日暂无 Claude / Anthropic 相关动态</p>';
  }
  
  // 统计来源
  const sourceStats = {};
  news.forEach(item => {
    const key = item.category === 'western_media' ? '🌍 西方媒体'
              : item.category === 'chinese_media' ? '🇨🇳 中文媒体'
              : item.isOfficial ? '🌟 Anthropic官方'
              : item.source.includes('Reddit') ? '🔴 Reddit'
              : item.source === 'Hacker News' ? '🟠 Hacker News'
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
        ${dateStr} · 共 ${news.length} 条更新 · 最近 ${DAYS_TO_KEEP} 天
      </p>
      <div style="margin-top: 8px;">${statsHTML}</div>
    </div>
    <div style="padding: 25px 30px;">${sectionsHTML}</div>
    <div style="background: #f9fafb; padding: 15px; text-align: center; font-size: 11px; color: #999;">
      由 GitHub Actions 自动生成 · 每天 11:58 北京时间
    </div>
  </div>
</body>
</html>`;
}

function generateMarkdown(news, groups) {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  
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

> 生成时间: ${date.toLocaleString('zh-CN')}
> 总更新数: ${news.length} (最近 ${DAYS_TO_KEEP} 天)

`;
  
  const renderSection = (title, items) => {
    if (items.length === 0) return '';
    let s = `\n## ${title} (${items.length})\n\n`;
    items.forEach((item, idx) => {
      const timeStr = new Date(item.publishedAt).toLocaleString('zh-CN');
      const icon = getSourceIcon(item.source, item.category);
      s += `### ${idx + 1}. ${item.title}\n\n`;
      s += `- **来源**: ${icon} ${item.source}\n`;
      s += `- **时间**: ${timeStr}\n`;
      if (item.points) s += `- **热度**: 👍 ${item.points}${item.commentsCount ? ` · 💬 ${item.commentsCount}` : ''}\n`;
      if (item.link) s += `- **链接**: ${item.link}\n`;
      if (item.description && item.description !== item.title) {
        s += `\n${String(item.description).substring(0, 500)}\n`;
      }
      s += '\n---\n\n';
    });
    return s;
  };
  
  md += renderSection('🌟 Anthropic 官方', groups.official);
  md += renderSection('📅 今天', groups.today);
  md += renderSection('📆 昨天', groups.yesterday);
  md += renderSection('📋 本周早些时候', groups.thisWeek);
  
  if (news.length === 0) md += '\n今日暂无更新。\n';
  
  return md;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 发送邮件
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendEmail(news, html, markdown) {
  console.log('【步骤5】发送邮件...');
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
  
  await transporter.verify();
  console.log('  ✓ SMTP 连接成功');
  
  const date = new Date();
  const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const isoDate = date.toISOString().split('T')[0];
  
  const result = await transporter.sendMail({
    from: GMAIL_USER,
    to: EMAIL_RECIPIENT,
    subject: `Claude.ai 日报 - ${dateStr} (${news.length} 条更新)`,
    html: html,
    attachments: [{
      filename: `claude-news-${isoDate}.md`,
      content: markdown,
      contentType: 'text/markdown; charset=utf-8',
    }],
  });
  
  console.log('  ✅ 邮件已发送!');
  console.log(`     消息ID: ${result.messageId}`);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主流程
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const startTime = Date.now();
  
  console.log('【步骤2】并行收集 9 个数据源...\n');
  
  const results = await Promise.allSettled([
    fetchHackerNews(),       // 1. HN
    fetchReddit(),            // 2. Reddit
    fetchGitHub(),            // 3. GitHub
    fetchAnthropicNews(),     // 4. Anthropic官方
    fetchGoogleNews(),        // 5. Google News (聚合西方主流)
    fetchWesternMediaRSS(),   // 6. 西方媒体官方RSS
    fetchChineseMediaRSS(),   // 7. 中文科技媒体
    fetchZhihu(),             // 8. 知乎
    fetchWeixin(),            // 9. 搜狗微信
  ]);
  
  let allNews = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allNews = allNews.concat(r.value);
    }
  });
  
  console.log(`\n  📊 9个数据源共收集: ${allNews.length} 条原始数据`);
  
  const filtered = filterAndDedupe(allNews);
  const groups = groupByTime(filtered);
  
  console.log('【步骤4】生成邮件内容...');
  console.log(`  - 🌟 官方公告: ${groups.official.length} 条`);
  console.log(`  - 📅 今天: ${groups.today.length} 条`);
  console.log(`  - 📆 昨天: ${groups.yesterday.length} 条`);
  console.log(`  - 📋 本周早些时候: ${groups.thisWeek.length} 条\n`);
  
  const html = generateHTML(filtered, groups);
  const markdown = generateMarkdown(filtered, groups);
  
  await sendEmail(filtered, html, markdown);
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n═══════════════════════════════════════════');
  console.log(`  ✅ 全部完成! (耗时 ${duration}s)`);
  console.log('═══════════════════════════════════════════\n');
}

// 异常捕获
process.on('unhandledRejection', err => { console.error('未处理的Promise拒绝:', err); process.exit(1); });
process.on('uncaughtException', err => { console.error('未捕获异常:', err); process.exit(1); });

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ 执行失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
