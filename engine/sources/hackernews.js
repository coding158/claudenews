'use strict';
// ⚠ 由 canonical 生成（canonical/elements/sources/hackernews.json）——请勿手改；改 canonical 后跑 `node generators/gen.mjs --apply` 重新生成。
const m = require('../../01-claudenews-main.js');
module.exports = { name: 'hackernews', kind: 'fetch', region: 'overseas', enabled: true, async fetch() { return m.fetchHackerNews(); } };
