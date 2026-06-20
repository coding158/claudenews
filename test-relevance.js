'use strict';
// 相关性精度补丁验证（不发邮件、不联网）：node test-relevance.js
const { textUtil } = require('./01-claudenews-main.js');

// [标题, 描述, 期望级别, 媒体源是否应放行(=== 'high')]
const cases = [
  // —— 真实误报：人名 Claude，媒体源必须拦掉 ——
  ['Claude Monet exhibition opens in Paris', '', 'low', false],
  ['Claude Shannon and information theory', 'a profile of the mathematician', 'low', false],
  ['Remembering Claude, a beloved teacher', '', 'low', false],
  // —— 真实正例：必须放行 ——
  ['Anthropic raises $2B for Claude', '', 'high', true],
  ['Claude 3.5 Sonnet released today', '', 'high', true],
  ['How to use the Claude API to build chatbots', '', 'high', true],
  ['克劳德大模型迎来重大更新', '', 'high', true],
  ['Claude vs GPT: which model wins?', '', 'high', true],
  ['Anthropic 发布新功能', '', 'high', true],
  // —— 完全无关 ——
  ['OpenAI launches a new model', '', 'none', false],
  ['今日天气晴', '', 'none', false],
];

let pass = 0, fail = 0;
for (const [title, desc, expLevel, expMediaPass] of cases) {
  const level = textUtil.relevanceLevel(title, desc);
  const mediaPass = level === 'high';
  const ok = level === expLevel && mediaPass === expMediaPass;
  console.log(`${ok ? '✅' : '❌'} [${level.padEnd(4)}] media:${mediaPass ? '放行' : '拦截'}  «${title}»`);
  if (ok) pass++; else { fail++; console.log(`     期望 level=${expLevel} mediaPass=${expMediaPass}`); }
}
console.log(`\n— ${pass} PASS / ${fail} FAIL —`);
process.exit(fail ? 1 : 0);
