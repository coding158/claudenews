'use strict';
const { readWire } = require('../wire');
module.exports = { name: 'newsjson', kind: 'wire', region: 'any', enabled: true, async fetch() { return readWire(); } };
