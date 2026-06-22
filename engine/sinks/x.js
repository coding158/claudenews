'use strict';
/**
 * X（Twitter）出口 —— STUB / 接口占位（默认禁用）。
 * 实现要点：X API v2 OAuth2 凭据走 env；把 p.items 前 N 条压成 ≤280 字串推；注意频控。
 */
module.exports = { name: 'x', kind: 'social', enabled: false, async send() { console.warn('  ⚠️  x 出口尚未实现（STUB）'); } };
