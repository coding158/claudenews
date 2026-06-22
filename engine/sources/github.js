'use strict';
const m = require('../../01-claudenews-main.js');
module.exports = { name: 'github', kind: 'fetch', region: 'any', enabled: true, async fetch() { return m.fetchGitHub(); } };
