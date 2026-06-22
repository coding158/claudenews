/**
 * 引擎（GitHub 侧）—— 与 Gitee 侧同构。按 profile 组合 Source 元 / 处理 / Sink 元。
 * 复用 01-claudenews-main.js 的处理/渲染/发信/缓存，保证与 live 主流程同一套逻辑。
 */
'use strict';

const m = require('../01-claudenews-main.js');
const { 源注册表 } = require('./sources');
const { 出口注册表 } = require('./sinks');
const PROFILES = require('./profiles');

const DAYS = 7;
const cutoff = Date.now() - DAYS * 86400000;

// 轻门禁（collect 用）：相关性≠none + 时间窗 + 标题去重；不碰历史/摘要。
function lightGate(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    if (!it || !it.title) continue;
    if (!it.isOfficial && m.textUtil.relevanceLevel(it.title, it.description || '') === 'none') continue;
    const when = it.publishedAt instanceof Date ? it.publishedAt : new Date(it.publishedAt || Date.now());
    if (!it.isOfficial && when.getTime() < cutoff) continue;
    const k = m.textUtil.normalize(it.title).slice(0, 60);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

async function run(profileName) {
  const profile = PROFILES[profileName];
  if (!profile) throw new Error(`未知 profile：${profileName}（可选：${Object.keys(PROFILES).join('/')}）`);

  console.log(`\n=== claudenews engine · profile=${profileName} ===`);
  console.log(profile.描述);

  const sel = 源注册表.filter(s => s.enabled && profile.sources.includes(s.name));
  console.log(`启用源：${sel.map(s => s.name).join(', ') || '（无）'}`);
  const res = await Promise.allSettled(sel.map(s => Promise.resolve().then(() => s.fetch())));
  let items = [];
  res.forEach((r, i) => {
    if (r.status === 'fulfilled' && Array.isArray(r.value)) { items = items.concat(r.value); console.log(`  ${sel[i].name}: ${r.value.length}`); }
    else console.warn(`  ${sel[i].name} 失败: ${(r.reason && r.reason.message) || ''}`);
  });
  console.log(`共采集：${items.length} 条`);

  let groups = null, html = '', markdown = '';
  if (profile.gate) { items = lightGate(items); console.log(`轻门禁后：${items.length} 条`); }
  if (profile.process) {
    m.cache.load(); m.cache.prune();
    items = m.processNews(items);
    groups = m.groupByTime(items);
  }
  if (profile.render) {
    html = m.renderHTML(items, groups);
    markdown = m.renderMarkdown(items, groups);
  }

  const payload = { items, groups, html, markdown, profile };

  const 出口 = 出口注册表.filter(k => k.enabled && profile.sinks.includes(k.name));
  console.log(`启用出口：${出口.map(k => k.name).join(', ') || '（无）'}`);
  let 邮件出口失败 = false;
  for (const k of 出口) {
    try { await k.send(payload); console.log(`  ✓ ${k.name}`); }
    catch (e) { console.error(`  ✗ ${k.name}: ${e.message}`); if (k.kind === 'email') 邮件出口失败 = true; }
  }

  if (profile.process) m.cache.save();
  if (邮件出口失败) throw new Error('邮件出口发送失败');
  console.log('✅ 完成');
}

module.exports = { run, lightGate };
