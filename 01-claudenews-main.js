#!/usr/bin/env node

/**
 * Claude News Collector - 超级稳定版
 * 保证不崩溃，所有错误都被捕获
 */

console.log('\n═══════════════════════════════════════════');
console.log('  Claude News Collector v2.0');
console.log('═══════════════════════════════════════════\n');

// 包装所有依赖加载
let fetch, nodemailer;

try {
  fetch = require('node-fetch');
  console.log('✓ node-fetch 已加载');
} catch (e) {
  console.error('❌ node-fetch 加载失败:', e.message);
  process.exit(1);
}

try {
  nodemailer = require('nodemailer');
  console.log('✓ nodemailer 已加载');
} catch (e) {
  console.error('❌ nodemailer 加载失败:', e.message);
  process.exit(1);
}

console.log('');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 步骤1: 环境变量检查
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

console.log('【步骤1】环境变量检查...');

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const EMAIL_RECIPIENT = process.env.EMAIL_RECIPIENT || GMAIL_USER;

console.log(`  GMAIL_USER: ${GMAIL_USER ? '✓ ' + GMAIL_USER : '❌ 未设置'}`);
console.log(`  GMAIL_APP_PASSWORD: ${GMAIL_APP_PASSWORD ? '✓ 已设置(' + GMAIL_APP_PASSWORD.length + '字符)' : '❌ 未设置'}`);
console.log(`  EMAIL_RECIPIENT: ${EMAIL_RECIPIENT ? '✓ ' + EMAIL_RECIPIENT : '❌ 未设置'}`);

if (!GMAIL_USER || !GMAIL_APP_PASSWORD) {
  console.error('\n❌ 致命错误: 缺少必要的环境变量');
  console.error('请在 GitHub Settings → Secrets 中配置:');
  console.error('  - GMAIL_USER');
  console.error('  - GMAIL_APP_PASSWORD');
  process.exit(1);
}

console.log('  ✅ 环境变量检查通过\n');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 步骤2: 安全的数据收集（每个源完全独立）
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function safeRequest(name, requestFn) {
  try {
    console.log(`  📡 ${name}...`);
    const result = await requestFn();
    console.log(`      ✓ 完成`);
    return result;
  } catch (error) {
    console.log(`      ⚠️  错误: ${error.message}`);
    return [];
  }
}

async function fetchHackerNews() {
  return safeRequest('Hacker News', async () => {
    const response = await fetch(
      'https://hn.algolia.com/api/v1/search?query=claude+anthropic&tags=story',
      { 
        headers: { 'User-Agent': 'ClaudeNewsCollector/2.0' },
        timeout: 15000 
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const hits = data.hits || [];
    
    const news = [];
    hits.slice(0, 10).forEach(hit => {
      if (hit.title && (hit.title.toLowerCase().includes('claude') || hit.title.toLowerCase().includes('anthropic'))) {
        news.push({
          title: String(hit.title),
          description: String(hit.title),
          link: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`,
          source: 'Hacker News',
          publishedAt: new Date(hit.created_at || Date.now()),
          points: hit.points || 0,
        });
      }
    });
    
    console.log(`      → 找到 ${news.length} 条相关`);
    return news;
  });
}

async function fetchReddit() {
  return safeRequest('Reddit r/ClaudeAI', async () => {
    const response = await fetch(
      'https://www.reddit.com/r/ClaudeAI/new.json?limit=20',
      {
        headers: { 'User-Agent': 'Mozilla/5.0 ClaudeNewsCollector/2.0' },
        timeout: 15000,
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const posts = data.data?.children || [];
    
    const news = [];
    posts.slice(0, 10).forEach(post => {
      const p = post.data;
      if (p && p.title) {
        news.push({
          title: String(p.title),
          description: String(p.selftext || p.title).substring(0, 300),
          link: `https://reddit.com${p.permalink}`,
          source: 'Reddit r/ClaudeAI',
          publishedAt: new Date((p.created_utc || Date.now() / 1000) * 1000),
          points: p.score || 0,
        });
      }
    });
    
    console.log(`      → 找到 ${news.length} 条`);
    return news;
  });
}

async function fetchAnthropicNews() {
  return safeRequest('Anthropic Official', async () => {
    const response = await fetch('https://www.anthropic.com/news', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 15000,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const html = await response.text();
    
    // 简单的标题提取（不依赖cheerio）
    const news = [];
    const titleMatches = html.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/g) || [];
    
    titleMatches.slice(0, 10).forEach(match => {
      const titleMatch = match.match(/<h[1-3][^>]*>([^<]+)<\/h[1-3]>/);
      if (titleMatch && titleMatch[1]) {
        const title = titleMatch[1].trim();
        if (title.length > 10 && title.length < 200) {
          news.push({
            title: title,
            description: title,
            link: 'https://www.anthropic.com/news',
            source: 'Anthropic Official',
            publishedAt: new Date(),
          });
        }
      }
    });
    
    console.log(`      → 找到 ${news.length} 条`);
    return news;
  });
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 步骤3: 去重和过滤
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function filterAndDedupe(items) {
  console.log('\n【步骤3】去重和过滤...');
  console.log(`  原始数据: ${items.length} 条`);
  
  // 必须有标题
  let filtered = items.filter(item => item && item.title && item.title.length > 0);
  console.log(`  过滤空标题后: ${filtered.length} 条`);
  
  // 去重
  const seen = new Set();
  filtered = filtered.filter(item => {
    const key = item.title.toLowerCase().substring(0, 80).trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  console.log(`  去重后: ${filtered.length} 条`);
  
  // 按时间倒序
  filtered.sort((a, b) => {
    const dateA = new Date(a.publishedAt).getTime() || 0;
    const dateB = new Date(b.publishedAt).getTime() || 0;
    return dateB - dateA;
  });
  
  // 最多保留20条
  filtered = filtered.slice(0, 20);
  console.log(`  最终保留: ${filtered.length} 条\n`);
  
  return filtered;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 步骤4: 生成邮件内容
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

function generateHTML(news) {
  const date = new Date();
  const dateStr = date.toLocaleDateString('zh-CN');
  
  let itemsHTML = '';
  if (news.length === 0) {
    itemsHTML = '<p style="color: #999; padding: 20px; text-align: center;">今日暂无 Claude / Anthropic 相关动态</p>';
  } else {
    news.forEach((item, idx) => {
      const timeStr = new Date(item.publishedAt).toLocaleString('zh-CN');
      itemsHTML += `
        <div style="border-left: 4px solid #667eea; padding: 15px; margin: 15px 0; background: #f9fafb; border-radius: 4px;">
          <h3 style="margin: 0 0 8px 0; color: #222; font-size: 15px;">${idx + 1}. ${escapeHtml(item.title)}</h3>
          <p style="margin: 5px 0; color: #666; font-size: 12px;">
            <strong>${escapeHtml(item.source)}</strong> · ${timeStr}
          </p>
          ${item.description && item.description !== item.title ? 
            `<p style="margin: 8px 0; color: #555; font-size: 13px; line-height: 1.5;">${escapeHtml(String(item.description).substring(0, 200))}${item.description.length > 200 ? '...' : ''}</p>` : ''}
          ${item.link ? 
            `<a href="${escapeHtml(item.link)}" style="color: #667eea; text-decoration: none; font-size: 12px;">→ 查看详情</a>` : ''}
        </div>`;
    });
  }
  
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Claude.ai 日报</title></head>
<body style="font-family: -apple-system, Arial, sans-serif; background: #f5f5f5; padding: 20px; margin: 0;">
  <div style="max-width: 720px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px;">
      <h1 style="margin: 0; font-size: 28px;">📰 Claude.ai 日报</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.95;">${dateStr} · ${news.length} 条更新</p>
    </div>
    <div style="padding: 30px;">${itemsHTML}</div>
    <div style="background: #f9fafb; padding: 15px; text-align: center; font-size: 11px; color: #999;">
      由 GitHub Actions 自动生成 · 每天 11:58
    </div>
  </div>
</body>
</html>`;
}

function generateMarkdown(news) {
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
> 总更新数: ${news.length}

`;
  
  if (news.length === 0) {
    md += '\n今日暂无 Claude / Anthropic 相关动态。\n';
  } else {
    news.forEach((item, idx) => {
      md += `## ${idx + 1}. ${item.title}\n\n`;
      md += `- **来源**: ${item.source}\n`;
      md += `- **发布时间**: ${new Date(item.publishedAt).toLocaleString('zh-CN')}\n`;
      if (item.link) md += `- **链接**: [${item.link}](${item.link})\n`;
      if (item.points) md += `- **热度**: ${item.points}\n`;
      if (item.description && item.description !== item.title) {
        md += `\n**摘要**: ${String(item.description).substring(0, 500)}\n`;
      }
      md += `\n---\n\n`;
    });
  }
  
  return md;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 步骤5: 发送邮件
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendEmail(news, html, markdown) {
  console.log('【步骤5】发送邮件...');
  
  console.log('  创建SMTP连接...');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: GMAIL_USER,
      pass: GMAIL_APP_PASSWORD,
    },
  });
  
  console.log('  验证SMTP连接...');
  try {
    await transporter.verify();
    console.log('  ✓ SMTP 连接验证成功');
  } catch (error) {
    console.error('  ❌ SMTP 验证失败!');
    console.error('  错误详情:', error.message);
    console.error('  请检查:');
    console.error('    1. Gmail应用密码是否正确(16位)');
    console.error('    2. Gmail账户是否启用了2步验证');
    console.error('    3. 应用密码是否还有效');
    throw error;
  }
  
  const date = new Date();
  const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  const isoDate = date.toISOString().split('T')[0];
  
  const mailOptions = {
    from: GMAIL_USER,
    to: EMAIL_RECIPIENT,
    subject: `Claude.ai 日报 - ${dateStr} (${news.length} 条更新)`,
    html: html,
    attachments: [{
      filename: `claude-news-${isoDate}.md`,
      content: markdown,
      contentType: 'text/markdown; charset=utf-8',
    }],
  };
  
  console.log(`  发送邮件给: ${EMAIL_RECIPIENT}`);
  
  try {
    const result = await transporter.sendMail(mailOptions);
    console.log('  ✅ 邮件发送成功!');
    console.log(`     消息ID: ${result.messageId}`);
    return true;
  } catch (error) {
    console.error('  ❌ 邮件发送失败:', error.message);
    throw error;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主流程
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  const startTime = Date.now();
  
  console.log('【步骤2】开始收集数据...\n');
  
  // 并行收集所有数据源（任何一个失败都不影响其他）
  const results = await Promise.allSettled([
    fetchHackerNews(),
    fetchReddit(),
    fetchAnthropicNews(),
  ]);
  
  // 合并所有结果
  let allNews = [];
  results.forEach(result => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      allNews = allNews.concat(result.value);
    }
  });
  
  console.log(`\n  📊 总计收集: ${allNews.length} 条原始数据`);
  
  // 过滤和去重
  const news = filterAndDedupe(allNews);
  
  // 生成邮件内容
  console.log('【步骤4】生成邮件内容...');
  const html = generateHTML(news);
  const markdown = generateMarkdown(news);
  console.log(`  ✓ HTML: ${html.length} 字节`);
  console.log(`  ✓ Markdown: ${markdown.length} 字节\n`);
  
  // 发送邮件
  await sendEmail(news, html, markdown);
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n═══════════════════════════════════════════');
  console.log(`  ✅ 全部完成! (耗时 ${duration}s)`);
  console.log('═══════════════════════════════════════════\n');
}

// 全局异常捕获
process.on('unhandledRejection', (error) => {
  console.error('\n❌ 未处理的Promise拒绝:');
  console.error(error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error('\n❌ 未捕获的异常:');
  console.error(error);
  process.exit(1);
});

// 启动
main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('\n═══════════════════════════════════════════');
    console.error('  ❌ 程序执行失败');
    console.error('═══════════════════════════════════════════');
    console.error('错误:', error.message);
    console.error('\n堆栈:');
    console.error(error.stack);
    console.error('═══════════════════════════════════════════\n');
    process.exit(1);
  });
