/**
 * Source 元 注册表（GitHub 侧）。加源 = 新建一个 ./xxx.js + 在此登记一行。
 * Source 元接口：{ name, kind:'fetch'|'wire', region, enabled, async fetch(ctx)→item[] }
 */
'use strict';

const 源注册表 = [
  require('./newsjson'),     // wire 源：读 news.json（反向消费用）
  require('./hackernews'),
  require('./reddit'),
  require('./github'),
  require('./anthropic'),
  require('./googlenews'),
  require('./westernrss'),
  require('./chineserss'),
  require('./zhihu'),
  require('./weixin'),
];

module.exports = { 源注册表 };
