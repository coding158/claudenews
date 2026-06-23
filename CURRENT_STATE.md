# CURRENT_STATE — 当前真实架构（防文档漂移）

> README.md 是 v5「单文件 9 源 → Gmail」的描述，仍大体有效，但**新增了"元引擎 + 跨端采集"**，本文件补全当前全貌。更新：2026-06-23。

## 本仓库的两个角色
1. **live Gmail（`claude-news.yml` + `01-claudenews-main.js` main）**：每天采 9 源 → 去重/分级(🟢🟡🔴⚫)/**GitHub Models 免费 AI 摘要** → Gmail。这是 v5 主流程，仍在跑。
2. **海外采集端（`collect-news-json.yml` + `run.js` `PROFILE=collect`）**：海外 runner 采 9 源 → 轻门禁 → **GitHub Models 免费摘要**前 `AI_MAX_SUMMARIZE`(80) 条 → 写 `news.json` → push 到 Gitee `claude-news-daily` 消费（→ 国内 139）。

## 元架构（`engine/`）
- **Source 元** `engine/sources/*`（带 region 标签，含 `newsjson` wire 源）+ **Sink 元** `engine/sinks/*`（wire-out/email-gmail/x-stub）+ **wire 合同** `engine/wire.js`（`news.json` schema v1，见 `NEWS-JSON-SCHEMA.md`）+ `engine/engine.js` + `profiles.js`（collect/consume）。
- 加源/出口 = 新建一个符合元接口的文件 + 注册一行。
- **摘要 = 可换 provider 的元**（`summarize.js`）：`github`(GitHub Models，免费，默认) / `deepseek` / `off`。
- live 的 `main()` 发信主干**未改**，只加了 exports 供 engine 复用 + 一步 `summarize()`(失败不影响发信)。

## 调度
- 海外采集 `collect-news-json.yml`：北京 04:00 / 09:00（早于 Gitee 11:58）。
- live Gmail `claude-news.yml`：repository_dispatch 准点 + schedule 兜底。

## 状态
AI 摘要免费（GitHub Models，`permissions: models: read`）、状态可信（`set -e` / guard 防双发）、源健康可视化。

## 已知 / roadmap
- 与 Gitee `claude-news-daily` 是「并行投影」（英文字段 / 中文字段）；理想态 canonical→projection（单一 Meta 源生成两端）。
- README 全量重写、`ROADMAP.md` 待补。
