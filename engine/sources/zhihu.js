'use strict';
const m = require('../../01-claudenews-main.js');
module.exports = { name: 'zhihu', kind: 'fetch', region: 'domestic', enabled: true, async fetch() { return m.fetchZhihu(); } };
