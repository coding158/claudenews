'use strict';
// 「元」分级 + 门禁验证（不发邮件、不联网）：node test-tier.js
const { assignTier, enrichMeta } = require('./01-claudenews-main.js');

// [item, 期望 tier]
const cases = [
  [{ title: 'Introducing Claude Opus 4.7', isOfficial: true }, '🟢'],
  [{ title: 'Anthropic raises $2B for Claude', category: 'western_media', link: 'https://nyt.com/x' }, '🟡'],
  [{ title: '克劳德大模型更新', category: 'chinese_media', link: 'https://36kr.com/x' }, '🟡'],
  [{ title: 'Claude 3.5 helped me code', source: 'Hacker News', category: undefined, link: 'https://hn/x' }, '🔴'],
  [{ title: 'Ask: thoughts on Claude AI?', source: 'Reddit r/ClaudeAI', link: 'https://r/x' }, '🔴'],
  [{ title: 'Claude Monet exhibition', category: 'western_media', link: 'https://x' }, '🔴'], // 裸人名→low→🔴
  [{ title: 'OpenAI launches model', category: 'western_media', link: 'https://x' }, '⚫'],     // 无关→⚫(门禁会丢)
];

// 门禁：模拟 processNews 的 §6.2.5
function gate(items) {
  items.forEach(enrichMeta);
  return items.filter(it => {
    if (it.isOfficial) return true;
    if (it.relevance === 'none') return false;
    if (it.source_tier === '🟡' && !it.link) it.source_tier = '🔴';
    return true;
  });
}

let pass = 0, fail = 0;
for (const [item, exp] of cases) {
  const tier = assignTier({ ...item, relevance: undefined });
  const ok = tier === exp;
  console.log(`${ok ? '✅' : '❌'} ${tier}  «${item.title}»  (期望 ${exp})`);
  if (ok) pass++; else fail++;
}

// 门禁整体：⚫ 应被丢弃
const kept = gate(cases.map(([i]) => ({ ...i })));
const droppedNone = !kept.some(i => i.relevance === 'none');
console.log(`\n门禁后保留 ${kept.length}/${cases.length} 条，⚫无关已丢弃: ${droppedNone ? '✅' : '❌'}`);
console.log(`分级分布: ${kept.map(i => i.source_tier).join(' ')}`);

console.log(`\n— ${pass}/${cases.length} 分级正确 ${droppedNone ? '+ 门禁OK' : '+ 门禁FAIL'} —`);
process.exit(fail === 0 && droppedNone ? 0 : 1);
