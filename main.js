#!/usr/bin/env node

/**
 * Claude News Collector - Main Script
 * 收集Claude.ai官方最新进展，每天11:58发送邮件
 * 数据源：官网、Twitter/X、YouTube、新闻聚合
 */

const fetch = require('node-fetch');
const cheerio = require('cheerio');
const nodemailer = require('nodemailer');
const Parser = require('rss-parser');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 配置部分
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const CONFIG = {
  gmail: {
    user: process.env.GMAIL_USER,
    appPassword: process.env.GMAIL_APP_PASSWORD,
  },
  recipient: process.env.EMAIL_RECIPIENT || process.env.GMAIL_USER,
  githubToken: process.env.GITHUB_TOKEN,
};

const parser = new Parser();

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 爬虫函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function scrapeOfficialWebsite() {
  const news = [];
  try {
    const response = await fetch('https://www.anthropic.com/', {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000,
    });
    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);
      $('article, .news, h1, h2').each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 20 && text.length < 200) {
          news.push({
            title: text.substring(0, 150),
            description: text,
            link: 'https://www.anthropic.com',
            source: 'Anthropic Official',
            publishedAt: new Date(),
            type: 'official',
            priority: 'high',
          });
        }
      });
    }
  } catch (error) {
    console.error('  ❌ 官方网站爬虫错误:', error.message);
  }
  return news;
}

async function scrapeTwitterX() {
  const news = [];
  const accounts = ['AnthropicAI', 'dmcn0', 'jackclarkSF'];
  
  for (const account of accounts) {
    try {
      const nitterUrl = `https://nitter.net/${account}/rss`;
      const feed = await parser.parseURL(nitterUrl);
      
      feed.items.slice(0, 3).forEach(item => {
        news.push({
          title: item.title?.substring(0, 100) || '',
          description: item.content || item.description || '',
          link: item.link || `https://twitter.com/${account}`,
          source: `Twitter/X (@${account})`,
          publishedAt: new Date(item.pubDate),
          type: 'twitter',
          priority: 'medium',
          author: account,
        });
      });
    } catch (error) {
      console.error(`    ⚠️  获取${account}推文失败`);
    }
  }
  return news;
}

async function scrapeYouTube() {
  const news = [];
  try {
    // 示例频道ID (需要替换为实际的Anthropic频道)
    const channels = [
      { id: 'UCJsQQkGdKON56u92-3NBLBQ', name: 'Anthropic' },
    ];
    
    for (const channel of channels) {
      try {
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`;
        const feed = await parser.parseURL(rssUrl);
        
        feed.items.slice(0, 3).forEach(item => {
          news.push({
            title: item.title || '',
            description: item.summary || '',
            link: item.link || '',
            source: `YouTube - ${channel.name}`,
            publishedAt: new Date(item.pubDate),
            type: 'youtube',
            priority: 'medium',
          });
        });
      } catch (error) {
        // 跳过错误
      }
    }
  } catch (error) {
    console.error('  ❌ YouTube爬虫错误:', error.message);
  }
  return news;
}

async function scrapeNewsAggregators() {
  const news = [];
  
  try {
    // Hacker News
    const hnResponse = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json');
    const storyIds = await hnResponse.json();
    
    for (const id of storyIds.slice(0, 5)) {
      try {
        const storyResponse = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`);
        const story = await storyResponse.json();
        
        if (story && story.title && (story.title.includes('Claude') || story.title.includes('AI'))) {
          news.push({
            title: story.title,
            description: story.title,
            link: story.url || `https://news.ycombinator.com/item?id=${id}`,
            source: 'Hacker News',
            publishedAt: new Date(story.time * 1000),
            type: 'hackernews',
            priority: 'low',
          });
        }
      } catch (e) {
        // 跳过
      }
    }
  } catch (error) {
    console.error('  ❌ 新闻聚合爬虫错误:', error.message);
  }
  
  return news;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 去重和过滤
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function deduplicateAndFilter(items) {
  // 1. 移除噪声
  let filtered = items.filter(item => {
    if (!item.title || item.title.trim().length < 10) return false;
    return true;
  });
  
  // 2. 保留相关内容
  filtered = filtered.filter(item => {
    const content = `${item.title} ${item.description}`.toLowerCase();
    return content.includes('claude') || content.includes('anthropic');
  });
  
  // 3. 去重
  const deduplicated = [];
  filtered.forEach(item => {
    const isDuplicate = deduplicated.some(existing => {
      const similarity = calculateSimilarity(item.title, existing.title);
      return similarity > 0.6;
    });
    if (!isDuplicate) {
      deduplicated.push({
        ...item,
        confidence: item.priority === 'high' ? '🟢' : item.priority === 'medium' ? '🟡' : '🔴',
      });
    }
  });
  
  // 4. 按优先级排序
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  deduplicated.sort((a, b) => {
    const priorityDiff = (priorityOrder[a.priority] || 2) - (priorityOrder[b.priority] || 2);
    if (priorityDiff !== 0) return priorityDiff;
    return new Date(b.publishedAt) - new Date(a.publishedAt);
  });
  
  return deduplicated;
}

function calculateSimilarity(str1, str2) {
  const normalize = (str) => str.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/);
  const set1 = new Set(normalize(str1));
  const set2 = new Set(normalize(str2));
  const intersection = [...set1].filter(x => set2.has(x)).length;
  const union = new Set([...set1, ...set2]).size;
  return union === 0 ? 0 : intersection / union;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 邮件生成
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

function generateEmailHTML(news) {
  const date = new Date();
  const dateStr = date.toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  
  return `
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude.ai 日报</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f5f5f5; padding: 20px; }
    .container { max-width: 720px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px 30px; }
    .header h1 { font-size: 32px; margin: 0 0 10px 0; }
    .content { padding: 30px; }
    .news-item { margin-bottom: 25px; padding: 15px; border-left: 4px solid #667eea; background: #f9fafb; border-radius: 4px; }
    .item-title { font-size: 15px; font-weight: 600; color: #222; line-height: 1.4; }
    .item-badge { display: inline-block; padding: 3px 8px; font-size: 12px; border-radius: 3px; margin-top: 5px; }
    .badge-high { background: #fef3c7; color: #d97706; }
    .badge-medium { background: #dbeafe; color: #0284c7; }
    .badge-low { background: #f3f4f6; color: #6b7280; }
    .item-meta { font-size: 12px; color: #666; margin: 8px 0; }
    .item-link { color: #667eea; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📰 Claude.ai 日报</h1>
      <p>${dateStr} (${news.length} 条更新)</p>
    </div>
    <div class="content">
      ${news.map((item, idx) => `
        <div class="news-item">
          <div class="item-title">${idx + 1}. ${item.title}</div>
          <div class="item-meta">${item.source} | ${item.publishedAt.toLocaleDateString('zh-CN')} ${item.confidence}</div>
          <div class="item-badge badge-${item.priority}">${item.priority.toUpperCase()}</div>
          ${item.link ? `<div style="margin-top: 10px;"><a href="${item.link}" class="item-link">→ 查看详情</a></div>` : ''}
        </div>
      `).join('')}
    </div>
  </div>
</body>
</html>
  `;
}

function generateMarkdownFile(news) {
  const date = new Date();
  const dateStr = date.toISOString().split('T')[0];
  
  let md = `# Claude.ai 日报 - ${dateStr}\n\n`;
  md += `> 生成时间: ${date.toLocaleString('zh-CN')}\n`;
  md += `> 总更新数: ${news.length}\n\n`;
  md += `---\ntags: [claude, ai, news, automated]\ndate: ${dateStr}\n---\n\n`;
  
  md += `## 更新内容\n\n`;
  news.forEach((item, idx) => {
    md += `### ${idx + 1}. ${item.title}\n\n`;
    md += `- **来源**: ${item.source}\n`;
    md += `- **优先级**: ${item.priority.toUpperCase()} ${item.confidence}\n`;
    md += `- **时间**: ${item.publishedAt.toLocaleString('zh-CN')}\n`;
    if (item.link) md += `- **链接**: [查看](${item.link})\n`;
    md += `\n`;
  });
  
  return md;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 邮件发送
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function sendEmail(news, htmlContent, markdownContent) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: CONFIG.gmail.user,
      pass: CONFIG.gmail.appPassword,
    },
  });
  
  const date = new Date();
  const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
  
  try {
    await transporter.sendMail({
      from: CONFIG.gmail.user,
      to: CONFIG.recipient,
      subject: `Claude.ai 日报 - ${dateStr} (${news.length} 条更新)`,
      html: htmlContent,
      attachments: [{
        filename: `claude-news-${date.toISOString().split('T')[0]}.md`,
        content: markdownContent,
        contentType: 'text/markdown; charset=utf-8',
      }],
    });
    
    console.log('✅ 邮件发送成功!');
    return true;
  } catch (error) {
    console.error('❌ 邮件发送失败:', error.message);
    return false;
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 上传到GitHub
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function uploadToGitHub(news, markdownContent) {
  if (!CONFIG.githubToken) {
    console.log('⚠️  未配置GITHUB_TOKEN，跳过GitHub上传\n');
    return false;
  }
  
  try {
    const date = new Date();
    const dateStr = date.toISOString().split('T')[0];
    const owner = 'coding158';
    const repo = 'claudenews';
    const branch = 'main';
    const path = `news/${dateStr}/index.md`;
    
    const fileContent = Buffer.from(markdownContent).toString('base64');
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${CONFIG.githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `Add Claude News - ${dateStr}`,
        content: fileContent,
        branch: branch,
      }),
    });
    
    if (response.ok) {
      console.log(`✅ 已上传到GitHub: ${owner}/${repo}`);
      return true;
    }
  } catch (error) {
    console.error('❌ GitHub上传失败:', error.message);
  }
  return false;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 主函数
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

async function main() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║    Claude News Collector v1.0          ║');
  console.log('╚════════════════════════════════════════╝\n');
  
  const startTime = Date.now();
  
  try {
    // 验证环境变量
    if (!CONFIG.gmail.user || !CONFIG.gmail.appPassword) {
      console.error('❌ 缺少必要的环境变量: GMAIL_USER, GMAIL_APP_PASSWORD');
      process.exit(1);
    }
    
    console.log('🔍 开始收集Claude.ai最新动态...\n');
    
    // 收集新闻
    const allNews = [];
    
    console.log('📰 正在抓取官方网站...');
    allNews.push(...await scrapeOfficialWebsite());
    
    console.log('🐦 正在抓取Twitter/X...');
    allNews.push(...await scrapeTwitterX());
    
    console.log('📹 正在抓取YouTube...');
    allNews.push(...await scrapeYouTube());
    
    console.log('📡 正在抓取新闻聚合源...');
    allNews.push(...await scrapeNewsAggregators());
    
    console.log(`\n✅ 收集到 ${allNews.length} 条原始数据`);
    
    // 去重和过滤
    const filteredNews = deduplicateAndFilter(allNews);
    console.log(`✅ 去重后保留 ${filteredNews.length} 条数据\n`);
    
    if (filteredNews.length === 0) {
      console.log('⚠️  今日没有新的Claude更新\n');
      process.exit(0);
    }
    
    // 生成邮件
    console.log('📧 正在生成邮件内容...');
    const htmlContent = generateEmailHTML(filteredNews);
    const markdownContent = generateMarkdownFile(filteredNews);
    console.log('✅ 邮件内容生成完成\n');
    
    // 发送邮件
    await sendEmail(filteredNews, htmlContent, markdownContent);
    
    // 上传到GitHub
    await uploadToGitHub(filteredNews, markdownContent);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log('\n╔════════════════════════════════════════╗');
    console.log(`║ ✅ 完成! (耗时 ${duration}s)            `);
    console.log('╚════════════════════════════════════════╝\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ 发生严重错误:', error.message);
    process.exit(1);
  }
}

main();
