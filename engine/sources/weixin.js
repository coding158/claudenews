'use strict';
const m = require('../../01-claudenews-main.js');
module.exports = { name: 'weixin', kind: 'fetch', region: 'domestic', enabled: true, async fetch() { return m.fetchWeixin(); } };
