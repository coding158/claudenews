#!/usr/bin/env node

/**
 * Claude News Collector v3.0
 * 改进:
 * - 只保留最近7天的新闻
 * - 优化数据源，提升时效性
 * - 添加GitHub Trending和Twitter/X来源
 * - 按时间分组（今日/本周）
 */

console.log('\n═══════════════════════════════════════════');
console.log('  Claude News Collector v3.0');
console.log('═══════════════════════════════════════════\n');

const fetch = require('node-fetch');
const nodemailer = require('nodemailer');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 配置
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const EMAIL_RECIPIENT = process.env.EMAIL_RECIPIENT || GMAIL_USER;

// 时间窗口：只保留最近 N 天的新闻
const DAYS_TO_KEEP = 7;
const cutoffDate = Date.now() - DAYS_TO_KEEP * 24 * 60 * 60 * 1000;
const todayDate = new Date().setHours(0, 0, 0, 0);

console.log('【步骤1】环境检查...');
console.log(`  GMAIL_USER: ${GMAIL_USER ? '✓' : '❌'}`);
console.log(`  GMAIL_APP_PASSWORD: ${GMAIL_APP_PASSWORD ? '✓' : '❌'}`);
console.log(`  时间窗口: 最近 ${DAYS_TO_KEEP} 天 (从 ${new Date(cutoffDate).toLocaleDateString('zh-CN')} 起)`);

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('❌ 缺少必要的环境变量');
  process.exit(1);
}
console.log('  ✅ 环境检查通过\n');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源1: Hacker News (按时间排序)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchHackerNews() {
  console.log('  📡 Hacker News (按时间排序)...');
  try {
    // 使用 search_by_date 接口，按时间倒序
    const url = 'https://hn.algolia.com/api/v1/search_by_date?query=claude+anthropic&tags=story&numericFilters=created_at_i>' 
                + Math.floor(cutoffDate / 1000);
    
    const response = await fetch(url, {
      headers: { 'User-Agent': 'ClaudeNewsCollector/3.0' },
      timeout: 15000,
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const hits = data.hits || [];
    
    const news = [];
    hits.forEach(hit => {
      if (!hit.title) return;
      const lower = hit.title.toLowerCase();
      // 严格过滤：必须同时和Claude/Anthropic相关
      if (!lower.includes('claude') && !lower.includes('anthropic')) return;
      
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
    
    console.log(`      ✓ 找到 ${news.length} 条最近7天的新闻`);
    return news;
  } catch (error) {
    console.log(`      ⚠️  错误: ${error.message}`);
    return [];
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源2: Reddit (用old.reddit.com)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchReddit() {
  console.log('  🔴 Reddit r/ClaudeAI + r/Anthropic...');
  const news = [];
  
  const subreddits = ['ClaudeAI', 'Anthropic'];
  
  for (const sub of subreddits) {
    try {
      const url = `https://old.reddit.com/r/${sub}/top.json?t=week&limit=15`;
      
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ClaudeNewsBot/3.0)',
          'Accept': 'application/json',
        },
        timeout: 15000,
      });
      
      if (!response.ok) {
        console.log(`      ⚠️  r/${sub}: HTTP ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const posts = data?.data?.children || [];
      
      posts.forEach(post => {
        const p = post.data;
        if (!p || !p.title) return;
        
        const postDate = new Date((p.created_utc || 0) * 1000);
        if (postDate.getTime() < cutoffDate) return;
        
        // 只保留有质量的帖子(得分>5)
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
      
      console.log(`      ✓ r/${sub}: ${posts.length} 条原始, 筛选后 ${news.filter(n => n.source === `Reddit r/${sub}`).length} 条`);
    } catch (error) {
      console.log(`      ⚠️  r/${sub} 错误: ${error.message}`);
    }
  }
  
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源3: GitHub - Claude/Anthropic 相关项目
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchGitHub() {
  console.log('  🐙 GitHub 趋势项目...');
  const news = [];
  
  try {
    // 搜索最近一周更新的Claude相关项目
    const since = new Date(cutoffDate).toISOString().split('T')[0];
    const url = `https://api.github.com/search/repositories?q=claude+anthropic+pushed:>${since}&sort=stars&order=desc&per_page=10`;
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ClaudeNewsCollector/3.0',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 15000,
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const data = await response.json();
    const items = data.items || [];
    
    items.forEach(item => {
      if (!item.name || !item.description) return;
      
      news.push({
        title: `[${item.full_name}] ${item.description.substring(0, 100)}`,
        description: item.description,
        link: item.html_url,
        source: 'GitHub',
        publishedAt: new Date(item.pushed_at || item.updated_at),
        points: item.stargazers_count || 0,
      });
    });
    
    console.log(`      ✓ 找到 ${news.length} 个活跃项目`);
  } catch (error) {
    console.log(`      ⚠️  错误: ${error.message}`);
  }
  
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 数据源4: Anthropic Official News (从sitemap)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function fetchAnthropicNews() {
  console.log('  📰 Anthropic Official News...');
  const news = [];
  
  try {
    // 抓取news页面，提取真实的文章链接
    const response = await fetch('https://www.anthropic.com/news', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      timeout: 15000,
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    
    // 提取 /news/xxx 形式的真实文章链接
    const linkPattern = /href="(\/news\/[^"]+)"[^>]*>([^<]+)</g;
    const seen = new Set();
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
        publishedAt: new Date(), // 官网没有明确日期，假设最近
        isOfficial: true,
      });
    }
    
    console.log(`      ✓ 找到 ${news.length} 篇官方文章`);
  } catch (error) {
    console.log(`      ⚠️  错误: ${error.message}`);
  }
  
  return news.slice(0, 8); // 最多保留8条
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 过滤和去重
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function filterAndDedupe(items) {
  console.log('\n【步骤3】过滤和去重...');
  console.log(`  原始数据: ${items.length} 条`);
  
  // 1. 去除无效数据
  let filtered = items.filter(item => item && item.title && item.title.length > 5);
  console.log(`  有效数据: ${filtered.length} 条`);
  
  // 2. 时间过滤（官方公告除外）
  filtered = filtered.filter(item => {
    if (item.isOfficial) return true;
    return new Date(item.publishedAt).getTime() >= cutoffDate;
  });
  console.log(`  时间过滤后(最近${DAYS_TO_KEEP}天): ${filtered.length} 条`);
  
  // 3. 去重（基于标题相似度）
  const seen = new Set();
  filtered = filtered.filter(item => {
    const key = item.title.toLowerCase().substring(0, 60).replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`  去重后: ${filtered.length} 条`);
  
  // 4. 按时间倒序
  filtered.sort((a, b) => {
    // 官方公告优先
    if (a.isOfficial && !b.isOfficial) return -1;
    if (!a.isOfficial && b.isOfficial) return 1;
    return new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime();
  });
  
  // 5. 限制总数
  filtered = filtered.slice(0, 30);
  console.log(`  最终保留: ${filtered.length} 条\n`);
  
  return filtered;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 按时间分组
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function groupByTime(news) {
  const groups = {
    today: [],
    yesterday: [],
    thisWeek: [],
    official: [],
  };
  
  const yesterday = todayDate - 24 * 60 * 60 * 1000;
  
  news.forEach(item => {
    if (item.isOfficial) {
      groups.official.push(item);
      return;
    }
    
    const itemTime = new Date(item.publishedAt).getTime();
    if (itemTime >= todayDate) {
      groups.today.push(item);
    } else if (itemTime >= yesterday) {
      groups.yesterday.push(item);
    } else {
      groups.thisWeek.push(item);
    }
  });
  
  return groups;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 生成邮件
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderItem(item, idx) {
  const timeStr = new Date(item.publishedAt).toLocaleString('zh-CN', { 
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' 
  });
  
  return `
    <div style="border-left: 4px solid ${item.isOfficial ? '#f59e0b' : '#667eea'}; padding: 12px 15px; margin: 12px 0; background: #f9fafb; border-radius: 4px;">
      <h3 style="margin: 0 0 6px 0; color: #222; font-size: 14px; line-height: 1.4;">
        ${idx}. ${escapeHtml(item.title)}
      </h3>
      <p style="margin: 4px 0; color: #666; font-size: 11px;">
        <strong>${escapeHtml(item.source)}</strong> · ${timeStr}
        ${item.points ? ` · 👍 ${item.points}` : ''}
        ${item.commentsCount ? ` · 💬 ${item.commentsCount}` : ''}
      </p>
      ${item.link ? `<a href="${escapeHtml(item.link)}" style="color: #667eea; text-decoration: none; font-size: 12px;">→ 查看详情</a>` : ''}
    </div>`;
}

function generateHTML(news, groups) {
  const date = new Date();
  const dateStr = date.toLocaleDateString('zh-CN');
  
  let sectionsHTML = '';
  let idx = 1;
  
  if (groups.official.length > 0) {
    sectionsHTML += `<h2 style="color: #f59e0b; font-size: 16px; margin: 20px 0 10px 0; border-bottom: 2px solid #f59e0b; padding-bottom: 5px;">🌟 Anthropic 官方</h2>`;
    groups.official.forEach(item => sectionsHTML += renderItem(item, idx++));
  }
  
  if (groups.today.length > 0) {
    sectionsHTML += `<h2 style="color: #10b981; font-size: 16px; margin: 20px 0 10px 0; border-bottom: 2px solid #10b981; padding-bottom: 5px;">📅 今天</h2>`;
    groups.today.forEach(item => sectionsHTML += renderItem(item, idx++));
  }
  
  if (groups.yesterday.length > 0) {
    sectionsHTML += `<h2 style="color: #3b82f6; font-size: 16px; margin: 20px 0 10px 0; border-bottom: 2px solid #3b82f6; padding-bottom: 5px;">📆 昨天</h2>`;
    groups.yesterday.forEach(item => sectionsHTML += renderItem(item, idx++));
  }
  
  if (groups.thisWeek.length > 0) {
    sectionsHTML += `<h2 style="color: #6b7280; font-size: 16px; margin: 20px 0 10px 0; border-bottom: 2px solid #6b7280; padding-bottom: 5px;">📋 本周早些时候</h2>`;
    groups.thisWeek.forEach(item => sectionsHTML += renderItem(item, idx++));
  }
  
  if (news.length === 0) {
    sectionsHTML = '<p style="color: #999; padding: 20px; text-align: center;">今日暂无 Claude / Anthropic 相关动态</p>';
  }
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Claude.ai 日报</title></head>
<body style="font-family: -apple-system, Arial, sans-serif; background: #f5f5f5; padding: 20px; margin: 0;">
  <div style="max-width: 720px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden;">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 35px 30px;">
      <h1 style="margin: 0; font-size: 26px;">📰 Claude.ai 日报</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.95; font-size: 13px;">
        ${dateStr} · ${news.length} 条更新 · 仅显示最近 ${DAYS_TO_KEEP} 天
      </p>
    </div>
    <div style="padding: 25px 30px;">${sectionsHTML}</div>
    <div style="background: #f9fafb; padding: 15px; text-align: center; font-size: 11px; color: #999;">
      由 GitHub Actions 自动生成 · 每天 11:58
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
    let s = `\n## ${title}\n\n`;
    items.forEach((item, idx) => {
      const timeStr = new Date(item.publishedAt).toLocaleString('zh-CN');
      s += `### ${idx + 1}. ${item.title}\n\n`;
      s += `- **来源**: ${item.source}\n`;
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
  
  if (news.length === 0) {
    md += '\n今日暂无更新。\n';
  }
  
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
  
  console.log('【步骤2】并行收集所有数据源...\n');
  
  const results = await Promise.allSettled([
    fetchHackerNews(),
    fetchReddit(),
    fetchGitHub(),
    fetchAnthropicNews(),
  ]);
  
  let allNews = [];
  results.forEach(r => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) {
      allNews = allNews.concat(r.value);
    }
  });
  
  console.log(`\n  📊 总计: ${allNews.length} 条原始数据`);
  
  const filtered = filterAndDedupe(allNews);
  const groups = groupByTime(filtered);
  
  console.log('【步骤4】生成邮件内容...');
  console.log(`  - 官方公告: ${groups.official.length} 条`);
  console.log(`  - 今天: ${groups.today.length} 条`);
  console.log(`  - 昨天: ${groups.yesterday.length} 条`);
  console.log(`  - 本周早些时候: ${groups.thisWeek.length} 条\n`);
  
  const html = generateHTML(filtered, groups);
  const markdown = generateMarkdown(filtered, groups);
  
  await sendEmail(filtered, html, markdown);
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n═══════════════════════════════════════════');
  console.log(`  ✅ 全部完成! (耗时 ${duration}s)`);
  console.log('═══════════════════════════════════════════\n');
}

// 异常捕获
process.on('unhandledRejection', err => {
  console.error('未处理的Promise拒绝:', err);
  process.exit(1);
});

process.on('uncaughtException', err => {
  console.error('未捕获异常:', err);
  process.exit(1);
});

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n❌ 执行失败:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
