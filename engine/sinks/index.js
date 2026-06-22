/**
 * Sink 元 注册表（GitHub 侧）。加出口 = 新建一个 ./xxx.js + 在此登记一行。
 * Sink 元接口：{ name, kind:'email'|'wire'|'social', enabled, async send(payload, ctx) }
 */
'use strict';
const 出口注册表 = [
  require('./wire-out'),     // 正向：写 news.json 推 Gitee
  require('./email-gmail'),  // 反向：env 门控的 Gmail
  require('./x'),            // STUB
];
module.exports = { 出口注册表 };
