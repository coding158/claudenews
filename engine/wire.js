/**
 * news.json 合同读写（GitHub 侧，英文内部字段）。schema 见 ../NEWS-JSON-SCHEMA.md。
 * readWire：news.json → 内部条目（link/publishedAt:Date）   —— wire 源用
 * writeWire：内部条目 → news.json                          —— wire 出口用
 */
'use strict';

const fs = require('fs');
const path = require('path');

const WIRE = path.resolve(__dirname, '..', 'news.json');

function catFromSource(s) { s = s || ''; if (s === 'GitHub') return 'project'; return 'community'; }

function readWire(p = WIRE) {
  if (!fs.existsSync(p)) { console.warn('  ⚠️  news.json 不存在，按 0 条处理'); return []; }
  let d;
  try { d = JSON.parse(fs.readFileSync(p, 'utf-8')); }
  catch (e) { console.warn('  ⚠️  news.json 解析失败：' + e.message); return []; }
  const items = Array.isArray(d.items) ? d.items : [];
  if (d.generatedAt) {
    const h = (Date.now() - new Date(d.generatedAt).getTime()) / 3600000;
    console.log(`  采集时间：${d.generatedAt}（约 ${h.toFixed(1)} 小时前）`);
  }
  return items.filter(it => it && it.title).map(it => ({
    title: it.title,
    link: it.url || '',
    description: it.description || '',
    source: it.source || '未知',
    publishedAt: new Date(it.publishedAt || Date.now()),
    isOfficial: !!it.isOfficial,
    points: it.points || 0,
    commentsCount: it.commentsCount || 0,
    category: it.category || undefined,
  }));
}

function writeWire(items, p = WIRE, source = 'github-actions/claudenews') {
  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source,
    count: items.length,
    items: items.map(it => ({
      title: it.title,
      url: it.link || '',
      description: String(it.description || '').slice(0, 500),
      source: it.source || '未知',
      publishedAt: (it.publishedAt instanceof Date ? it.publishedAt : new Date(it.publishedAt || Date.now())).toISOString(),
      category: it.isOfficial ? 'official' : (it.category || catFromSource(it.source)),
      isOfficial: !!it.isOfficial,
      points: it.points || 0,
      commentsCount: it.commentsCount || 0,
      aiSummary: it.aiSummary || '',   // 海外端 GitHub Models 摘要，随合同带给国内
    })),
  };
  fs.writeFileSync(p, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`  ✓ news.json 写入 ${items.length} 条`);
  return p;
}

module.exports = { readWire, writeWire, WIRE };
