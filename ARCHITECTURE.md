<!-- ⚠ 本文件由 canonical 生成（claude-news-canonical/canonical/docs/architecture.md）——请勿手改；改 canonical 后跑 `node generators/gen.mjs --apply --only=docs` 重新生成到两仓。 -->

# claude-news 架构（ARCHITECTURE）

> **单一真源 → 投影到两仓**：本文件由 canonical 生成，GitHub `claudenews` 与 Gitee `claude-news-daily` 内容一致，
> 杜绝双份文档漂移（F5 根治）。各仓 README 只保留"是什么/快速开始"，架构以本文件为准。更新随 canonical。

## 一句话
GitHub 海外采集 → `news.json` 合同 → Gitee 国内消费 → 139 发信；另有独立的 GitHub→Gmail 链路。

## 两仓分工
- **GitHub `claudenews`**：① 海外采集端（`PROFILE=collect`，海外 runner 能访问被墙源）→ 写 `news.json` 推 Gitee；② 独立 live Gmail（`claude-news.yml` + `01-claudenews-main.js` main）。
- **Gitee `claude-news-daily`**：国内消费端（`PROFILE=consume`）→ 读 `news.json` → 处理 → 139 发信 + 归档 + 跨运行去重回写。

## 双链路
- **正向（主）**：GitHub collect 采 9 源（HN/Google News/西方 RSS/GitHub/Anthropic 官方…）→ **GitHub Models 免费摘要**前 `AI_MAX_SUMMARIZE`(80) 条 → `news.json` → push Gitee → consume：关键词/相关性门禁(🟢🟡🔴⚫)/相似度+历史去重 → 缺摘要的用 **ApiFreeLLM（国内免费）补** → 139 发信。
- **独立**：GitHub live `claude-news.yml` 采 9 源 → 去重/分级/GitHub Models 摘要 → Gmail。

## 元架构
- **Source 元**（带 region 标签）+ **Sink 元** + **wire 合同**（`news.json` schema v1，见 `NEWS-JSON-SCHEMA.md`）+ engine + profiles（collect/consume/hybrid）。加源/出口 = 新建一个符合元接口的文件 + 注册一行。
- **摘要 = 可换 provider 的元**：GitHub 端 `github`(GitHub Models，免费) / Gitee 端 `deepseek` / `off` / `apifreellm`(国内免费备用) / 任意 OpenAI 兼容。要零成本就换 provider，不删能力。

## 已纳入 canonical 的元（自动生成，随迁移增长）
| 类型 | 名称 | 说明 | region | 投影 |
|---|---|---|---|---|
| source | `github` | GitHub 热门 Claude/Anthropic 相关仓库 | any | github / gitee |

## 调度
GitHub collect：北京 04:00 / 09:00（早于 Gitee 11:58）。Gitee consume：每天 11:58。GitHub live Gmail：repository_dispatch 准点 + schedule 兜底。

## 状态
全自动、零运维、**AI 摘要 100% 免费**（GitHub Models + ApiFreeLLM）、**零 DeepSeek 成本**、状态可信（`set -e`，绿=真发出）、源健康可视化（0 条/报错源汇总）。

## 治理（Meta_Kim「元」）
canonical→projection（不 fork→fork）· 安全护栏不关 · 删能力≠换实现 · 能力按可达性落到对的端用合同搬运 · 描述==现实。
详见 `mind-body-health/yuan/` 蓝皮书 §13 + 复用 playbook。

## roadmap
- F1：把其余 Source/Sink 元逐个搬进 canonical → 生成 `index.js` 注册表 → profiles/wire schema 入 canonical → engine 层全为生成产物。
- F5：README 主体也改单源生成（本架构文档已是单源）。
