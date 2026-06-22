'use strict';
const m = require('../../01-claudenews-main.js');
module.exports = { name: 'chineserss', kind: 'fetch', region: 'domestic', enabled: true, async fetch() { return m.fetchChineseMediaRSS(); } };
