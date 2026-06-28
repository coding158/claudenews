'use strict';
// ⚠ 由 canonical 生成（canonical/elements/sources/newsjson.json）——请勿手改；改 canonical 后跑 `node generators/gen.mjs --apply` 重新生成。
const { readWire } = require('../wire');
module.exports = { name: 'newsjson', kind: 'wire', region: 'any', enabled: true, async fetch() { return readWire(); } };
