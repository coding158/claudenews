#!/usr/bin/env node
/**
 * claudenews engine 入口（薄）。运行端与角色解耦：
 *   PROFILE=collect（默认）采集海外源 → 写 news.json（推 Gitee 消费）—— GitHub 主职责
 *   PROFILE=consume        读 news.json → 处理 → Gmail（反向）
 *
 * 注：现有发 Gmail 的 live 主流程仍是 `node 01-claudenews-main.js`（claude-news.yml），不受本入口影响。
 * 元架构与 Gitee 侧同构，见 NEWS-JSON-SCHEMA.md。
 */
'use strict';

const { run } = require('./engine/engine');

process.on('unhandledRejection', e => { console.error(e); process.exit(1); });
process.on('uncaughtException', e => { console.error(e); process.exit(1); });

const profile = process.env.PROFILE || 'collect';
run(profile).then(() => process.exit(0)).catch(e => { console.error('执行失败:', e.message); console.error(e.stack); process.exit(1); });
