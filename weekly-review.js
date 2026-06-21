#!/usr/bin/env node
'use strict';
/**
 * 监理 · 周复盘（移植自 mind-body-health 的 Meta_Kim 监理复盘）
 * 读取 cache/run-log.jsonl 最近 7 天，聚合：准点率 / 源健康度 / 元门禁拦截率 / 去重率 / tier 分布，
 * 写入 archive/review-YYYY-Www.md；有 GMAIL 环境变量时邮件发送。
 *
 *   node weekly-review.js
 */

const fs = require('fs');

const LOG = 'cache/run-log.jsonl';
const TZ = 'Asia/Shanghai';
const TARGET = { h: 11, m: 58 };      // 目标送达 北京 11:58
const WINDOW = 15;                    // 准点容差(分钟)
const TIER_LABEL = { '🟢': '官方', '🟡': '权威媒体', '🔴': '社区/待核', '⚫': '未证实' };

function shanghaiHM(iso) {
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function isoWeek(d = new Date()) {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function load() {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function buildReport(entries) {
  const recent = entries.slice(-7);
  const n = recent.length;
  const week = isoWeek();
  const alerts = [];

  if (n === 0) {
    return { week, md: `# 监理周复盘 · ${week}\n\n> 暂无 run-log 数据（项目刚接入或本周未运行）。\n`, alerts };
  }

  // 准点率
  const onTime = recent.filter(e => Math.abs(shanghaiHM(e.sent_at) - (TARGET.h * 60 + TARGET.m)) <= WINDOW).length;
  if (onTime < 5) alerts.push(`准点率偏低：${onTime}/${n}（目标 ≥5/7）`);

  // 源健康度
  const sources = {};
  recent.forEach(e => Object.entries(e.by_source || {}).forEach(([s, c]) => {
    sources[s] = sources[s] || { total: 0, days: 0 };
    sources[s].total += c; sources[s].days += 1;
  }));
  Object.entries(sources).forEach(([s, v]) => {
    if (n - v.days >= 3) alerts.push(`来源「${s}」本周 ${n - v.days} 天空跑`);
  });

  // 元门禁 / 去重 / tier
  const gate = recent.reduce((a, e) => { a.input += e.gate?.input || 0; a.dropped += e.gate?.dropped || 0; return a; }, { input: 0, dropped: 0 });
  const dropRate = gate.input ? (gate.dropped / gate.input * 100) : 0;
  if (dropRate > 20) alerts.push(`元门禁拦截率偏高：${dropRate.toFixed(0)}%（>20%，检查 fetcher 相关性/tier）`);
  const dedup = recent.reduce((a, e) => { a.before += e.dedup?.before || 0; a.after += e.dedup?.after || 0; return a; }, { before: 0, after: 0 });
  const tierTotals = {};
  recent.forEach(e => Object.entries(e.by_tier || {}).forEach(([t, c]) => tierTotals[t] = (tierTotals[t] || 0) + c));
  const avg = (recent.reduce((a, e) => a + (e.total || 0), 0) / n).toFixed(1);

  let md = `# 监理周复盘 · ${week}\n\n`;
  md += `> 覆盖最近 ${n} 天（${recent[0].date} ~ ${recent[n - 1].date}）· 生成 ${new Date().toISOString()}\n\n`;
  md += alerts.length
    ? `## 🚦 告警\n${alerts.map(a => `- ⚠️ ${a}`).join('\n')}\n\n`
    : `## 🚦 告警\n- ✅ 本周无红线告警\n\n`;
  md += `## ⏰ 准点率\n- **${onTime}/${n}** 天落在 11:58±${WINDOW}min\n`;
  md += recent.map(e => `  - ${e.date}: ${new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(e.sent_at))}`).join('\n') + '\n\n';
  md += `## 📡 来源健康度\n| 来源 | 总条数 | 有产出天数 | 空跑天数 |\n|------|------:|------:|------:|\n`;
  md += Object.entries(sources).sort((a, b) => b[1].total - a[1].total)
    .map(([s, v]) => `| ${s} | ${v.total} | ${v.days}/${n} | ${n - v.days} |`).join('\n') + '\n\n';
  md += `## 🛡️ 元门禁 & 去重\n`;
  md += `- 门禁：输入 ${gate.input} → 拦截 ${gate.dropped}（${dropRate.toFixed(0)}%）\n`;
  md += `- 去重：${dedup.before} → ${dedup.after}\n`;
  md += `- tier 分布：${['🟢', '🟡', '🔴', '⚫'].filter(t => tierTotals[t]).map(t => `${t}${TIER_LABEL[t]} ${tierTotals[t]}`).join(' · ') || '—'}\n`;
  md += `- 日均推送：${avg} 条\n`;
  return { week, md, alerts };
}

async function maybeEmail(md, week) {
  const user = process.env.GMAIL_USER, pass = process.env.GMAIL_APP_PASSWORD, to = process.env.EMAIL_RECIPIENT;
  if (!user || !pass || !to) { console.log('（无 GMAIL 环境变量，跳过邮件，仅归档）'); return; }
  let nodemailer;
  try { nodemailer = require('nodemailer'); } catch { console.log('（无 nodemailer，跳过邮件）'); return; }
  const t = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
  await t.sendMail({
    from: user, to,
    subject: `监理周复盘 · ${week}`,
    text: md,
    attachments: [{ filename: `review-${week}.md`, content: md, contentType: 'text/markdown; charset=utf-8' }],
  });
  console.log('✅ 复盘邮件已发送');
}

async function main() {
  const entries = load();
  const { week, md, alerts } = buildReport(entries);
  fs.mkdirSync('archive', { recursive: true });
  const out = `archive/review-${week}.md`;
  fs.writeFileSync(out, md);
  console.log(`✅ 已写入 ${out}`);
  console.log(`告警 ${alerts.length} 条` + (alerts.length ? '：\n - ' + alerts.join('\n - ') : ''));
  console.log('\n' + md);
  await maybeEmail(md, week);
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('复盘失败:', e.message); process.exit(1); });
}

module.exports = { buildReport, isoWeek };
