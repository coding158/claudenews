'use strict';

/**
 * AI 一句话摘要（OpenAI 兼容，provider 可切换）。给 GitHub 版 Gmail 流程加摘要。
 *
 * 选 provider（env AI_PROVIDER）：
 *   github(默认)：GitHub Models —— 在 Actions 里用 GITHUB_TOKEN，免费、零额外密钥
 *                  （需 workflow 加 permissions: models: read；端点/模型可用 AI_BASE_URL/AI_MODEL 覆盖）
 *   deepseek    ：需 DEEPSEEK_API_KEY
 *   off         ：跳过
 * 任何失败都不抛到主流程（调用方已 try/catch），最多让本条目没摘要。
 */

const fetch = require('node-fetch');

function resolveProvider() {
  const p = (process.env.AI_PROVIDER || '').toLowerCase();
  if (p === 'off') return null;

  if (p === 'deepseek') {
    if (!process.env.DEEPSEEK_API_KEY) return null;
    return { name: 'DeepSeek', base: process.env.AI_BASE_URL || 'https://api.deepseek.com', key: process.env.DEEPSEEK_API_KEY, model: process.env.AI_MODEL || 'deepseek-chat' };
  }

  // 默认 / 'github'：优先 GitHub Models（Actions 里 GITHUB_TOKEN 免费）
  const ght = process.env.GH_MODELS_TOKEN || process.env.GITHUB_TOKEN;
  if (p === 'github' || (!p && ght)) {
    if (ght) return { name: 'GitHub Models', base: process.env.AI_BASE_URL || 'https://models.github.ai/inference', key: ght, model: process.env.AI_MODEL || 'openai/gpt-4o-mini' };
  }

  // 回退：有 DeepSeek key 就用
  if (process.env.DEEPSEEK_API_KEY) return { name: 'DeepSeek', base: 'https://api.deepseek.com', key: process.env.DEEPSEEK_API_KEY, model: 'deepseek-chat' };
  return null;
}

async function callBatch(prov, batch) {
  const list = batch.map((it, i) => `${i + 1}. [${it.source || ''}] ${it.title}`).join('\n');
  const prompt = `你是AI新闻编辑。为以下每条新闻生成一句话中文摘要（20-50字；英文标题先翻译再概括）。直接输出JSON字符串数组，不要解释。\n\n${list}\n\n示例：["摘要1","摘要2"]`;
  const res = await fetch(`${prov.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${prov.key}` },
    body: JSON.stringify({ model: prov.model, messages: [{ role: 'user', content: prompt }], max_tokens: 600, temperature: 0.3 }),
  });
  if (!res.ok) throw new Error(`${prov.name} HTTP ${res.status}`);
  const data = await res.json();
  let text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '').replace(/```json|```/g, '').trim();
  let arr;
  try { arr = JSON.parse(text); }
  catch { const m = text.match(/\[[\s\S]*\]/); if (m) arr = JSON.parse(m[0]); else throw new Error('无法解析摘要响应'); }
  let ok = 0;
  if (Array.isArray(arr)) batch.forEach((it, i) => { if (arr[i]) { it.aiSummary = String(arr[i]).slice(0, 200); ok++; } });
  return ok;
}

async function summarize(items) {
  const prov = resolveProvider();
  if (!prov) { console.log('  AI 摘要: 跳过（未配置 provider，设 AI_PROVIDER=github/deepseek 启用）'); return; }
  if (!items || !items.length) return;
  console.log(`  AI 摘要: 用 ${prov.name}（${prov.model}）为 ${items.length} 条生成...`);
  const batchSize = 5;
  let ok = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    try { ok += await callBatch(prov, items.slice(i, i + batchSize)); }
    catch (e) { console.warn(`  摘要批次失败: ${e.message}`); }
    if (i + batchSize < items.length) await new Promise(r => setTimeout(r, 500));
  }
  console.log(`  ✓ AI 摘要完成: ${ok}/${items.length}`);
}

module.exports = { summarize };
