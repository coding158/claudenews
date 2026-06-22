'use strict';
const m = require('../../01-claudenews-main.js');
module.exports = { name: 'hackernews', kind: 'fetch', region: 'overseas', enabled: true, async fetch() { return m.fetchHackerNews(); } };
