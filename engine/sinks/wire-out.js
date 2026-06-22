'use strict';
const { writeWire } = require('../wire');
// wire 出口：写 news.json（正向：GitHub 采集 → 写 json → 由 workflow 推到 Gitee 消费）
module.exports = { name: 'wire-out', kind: 'wire', enabled: true, async send(p) { return writeWire(p.items); } };
