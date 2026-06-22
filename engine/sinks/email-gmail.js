'use strict';
const m = require('../../01-claudenews-main.js');
// Gmail 出口（复用 live 的 sendEmail）。env 门控：配了 GMAIL_USER 才启用。
module.exports = { name: 'email-gmail', kind: 'email', enabled: !!process.env.GMAIL_USER, async send(p) { return m.sendEmail(p.items, p.html, p.markdown); } };
