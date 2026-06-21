# claude-news 整合设计书

> 把「修行」（mind-body-health）项目的**「元」门禁**与**「监理」复盘**两套纪律，
> 移植到 claude-news 日报项目；同时解决**送达时间不固定**与**两套代码分裂**两个硬伤。
>
> 状态：实施中（P1 ✅ 精度 / P2 ✅ 准点 / P4 ✅ 元 / P5 ✅ 监理 已落地验证；P3 ⏸️ 暂缓、P0 待办，见 §7）· 创建 2026-06-20 · 更新 2026-06-21

---

## 0. TL;DR（先看结论）

1. **状态确认（已更正）**：GitHub 工作流**每天都在跑**（06/15–06/20 连续送达，Gmail 发件）。早前从本地陈旧克隆推断的"停摆"不成立——那份克隆只是 20 天没 pull。
2. **准点**：实测**每天延迟 6+ 小时且时间不固定**（如 06/20 到 16:36）。GitHub Actions `schedule:` cron 天然不准、cron-job.org 精准触发未生效。准点必须靠 **CI 之外的触发器**。推荐方案 A（外部 `repository_dispatch` 触发 + 采集仍在 CI）。
3. **整合**：现有两套代码——GitHub 单文件 **v5.0**（逻辑新、在跑）vs Gitee 模块化 **v1.0**（结构好）。决策：**以 v5.0 逻辑为内核，落进 v1.0 的分层骨架**，统一一套推 GitHub。
4. **「元」**：每条新闻升级为一个「元」，强制带 `source_tier / provenance / responsibility / boundary`，发送前过 `validate` 门禁。🔴⚫ 条目在邮件里显式标注。**「元」门禁顺带解决精度问题**（下条）。
5. **精度（用户实测）**：邮件里"有些不含 Claude 新闻"。根因：`isRelevant` 用裸 `includes('claude')`，而 **"Claude" 是常见人名**（Claude Monet 等），西方媒体/Google News 把同名报道也放了进来。修法：相关性须 **"claude" 与 AI 语境词共现**（anthropic/AI/model/LLM/opus/sonnet/haiku…），并落到 source_tier 分级。
6. **「监理」**：每周自动复盘——准点率 / 各源健康度 / 去重命中率 / 门禁拦截率 / AI 摘要抽检，产出监理报告。
7. **安全**：Gitee 版 `.workflow/daily-news.yml` 明文提交了邮箱密码与 DeepSeek Key，且残留 `>>>>>>> master` 冲突标记 —— 视为已泄露，需轮换 + 改 secret。

---

## 1. 现状（实测）

### 1.1 两套并存的代码
| 维度 | GitHub `coding158/claudenews`（线上） | Gitee `coding158/claude-news-daily` |
|------|--------------------------------------|-------------------------------------|
| 形态 | 单文件 `01-claudenews-main.js` v5.0 | 模块化 `src/{fetchers,processor,renderer,mailer,storage}` v1.0 |
| 数据源 | 9 源 | 知乎/微信/RSS/GitHub/微博 |
| 去重 | jaccard + 标准化 + 历史增量(`cache/history.json`) | dedup 模块（较早） |
| 解析 | fast-xml-parser / p-limit / Google News 解码 | node-fetch + 正则 |
| 调度 | GitHub Actions（`schedule` + `workflow_dispatch`） | Gitee Go（`.workflow/daily-news.yml`） |
| 时区 | Asia/Shanghai 统一 | — |
| 优点 | **逻辑最新、去重强、在跑** | **结构清晰、易扩展、好移植「元」** |
| 隐患 | 单文件难加门禁 | v1 逻辑旧；明文密钥；残留冲突标记 |

> 结论：**逻辑取 GitHub v5，结构取 Gitee 模块化**。两者都不能直接当最终基线。

### 1.2 「不能固定时间」根因（已量化）
用户实测：**每天延迟 6+ 小时、时间不固定**（如 06/20 到 16:36，目标约 11:58 北京）。
- GitHub Actions `schedule:` cron 是尽力而为，高峰延迟数十分钟~数小时甚至跳过（官方明示不保证）。当前现象 = **只有被延迟的兜底 cron 在跑**。
- workflow 注释里"cron-job.org 精准触发"**实际未生效**（`workflow_dispatch` 走 API 需有效 PAT）。

### 1.3 内容精度根因（用户实测「有些不含 Claude 新闻」）
线上 `01-claudenews-main.js` 的相关性判断（§2.3 `isRelevant`）：
```js
isRelevant(text) {
  const lower = text.toLowerCase();
  return lower.includes('claude') || lower.includes('anthropic')
      || text.includes('克劳德') || ...;
}
```
- 裸 `includes('claude')` 命中**人名 "Claude"**（Claude Monet / Claude Shannon / 叫 Claude 的政客）。
- Google News 查询 `'Anthropic Claude'` 是松匹配，且只对**标题**查相关性 → "Claude 画展"之类标题含 claude 即放行。
- 西方媒体源贡献最多此类误报（邮件标题常见"西方媒体: 20~25"）。

---

## 2. 目标

- **G1 准点**：每天固定时刻（误差 < 5 分钟）送达。
- **G2 可信**：每条新闻可溯源、分级、标注边界（「元」纪律）。
- **G3 可治理**：发送前 CI 门禁拦截不合格条目；每周自动复盘（「监理」纪律）。
- **G4 单一基线**：一套代码、一处部署，消除 GitHub/Gitee 分裂。
- **G5 安全**：无明文密钥。

---

## 3. 「元」移植：新闻条目元数据规范

### 3.1 映射（修行 → 新闻）
| 修行项目「元」 | 新闻条目「元」 | 取值 |
|---|---|---|
| `source_tier` | `source_tier` | 🟢官方(Anthropic/docs/官博) · 🟡权威媒体 · 🔴社区/转载 · ⚫未证实 |
| `provenance` | `provenance` | 原始 URL + 抓取时间(ISO) + fetcher 名 |
| `responsibility` | `responsibility` | 哪个源/fetcher 对这条负责 |
| `boundary` | `boundary` | 摘要不夸大不编造；AI 摘要标注"机器生成"；🔴⚫ 不作事实背书 |
| `status`(🟡) | `verify_status` | 已核 / 待核 / 存疑 |

### 3.2 升级后的条目结构
在 `src/fetchers/base.js` 的 `创建条目()` 上扩展（保持向后兼容）：

```js
function 创建条目(标题, 链接, 描述, 来源, 发布时间, 附加信息 = {}) {
  return {
    标题, 链接, 描述, 来源, 发布时间,
    // —— 新增「元」字段 ——
    source_tier: 附加信息.source_tier || '⚫',        // 默认最低可信，强制各 fetcher 显式提级
    provenance: { url: 链接, fetched_at: new Date().toISOString(), fetcher: 附加信息.fetcher || 来源 },
    responsibility: 附加信息.fetcher || 来源,
    boundary: 附加信息.boundary || '仅资讯聚合，不作事实背书；AI 摘要为机器生成',
    verify_status: 附加信息.verify_status || '待核',
    ...附加信息,
  };
}
```

各 fetcher 按源显式打 tier：`github.js`/官方 RSS → 🟢；知乎/微博热榜 → 🔴（社区）；DeepSeek 摘要 → 标注机器生成。

### 3.3 相关性置信度（修「有些不含 Claude」）
把"是不是 Claude 新闻"从布尔升级为带语境的判定，并喂给 tier：
```js
isRelevant(text) {
  const t = (text||'').toLowerCase();
  const hasAnthropic = t.includes('anthropic') || text.includes('安特罗匹克');
  const hasClaude    = t.includes('claude') || text.includes('克劳德');
  // AI 语境词：claude 必须与其一共现，才算 Claude-AI 新闻
  const aiCtx = /(anthropic|\bai\b|llm|model|chatbot|opus|sonnet|haiku|大模型|人工智能|对话|助手)/i.test(text);
  if (hasAnthropic) return 'high';              // anthropic 出现即高置信
  if (hasClaude && aiCtx) return 'high';         // claude + AI 语境
  if (hasClaude && !aiCtx) return 'low';         // 裸 claude（疑似人名）→ 低置信
  return 'none';
}
```
- 判定对**标题 + 描述**一起跑（不只标题）。
- `none` → 丢弃；`low` → 降级 🔴 并在邮件标注"疑似同名，请核实"或直接丢；`high` 才进 🟢/🟡。

### 3.4 发送前门禁 `src/processor/validate.js`（仿 `validate.py`）
```
对每条 item：
  相关性 = none                                   → FAIL（丢弃，计精度拦截）
  缺 source_tier / tier 非法(非🟢🟡🔴⚫)           → FAIL（丢弃）
  🟢🟡 但 provenance.url 为空                      → FAIL（降级到 🔴 或丢弃）
  缺 responsibility / boundary                     → FAIL
汇总：N PASS / N WARN / N FAIL；FAIL>0 时该条不进邮件，并计入监理报告。
```
- 邮件渲染：每条前置 tier 徽标；🔴⚫ 显式标注"社区来源/未证实，请自行核实"。
- CI 增加一步 `node src/processor/validate.js --dry`，可在 PR 上跑（对应修行的 `validate.yml`）。

---

## 4. 「监理」移植：每周自动复盘

仿 Meta_Kim「监理复盘」，新增 `src/monitor/weekly-review.js`，每周一产出报告（邮件 + 归档 `archive/review-YYYY-WW.md`）：

| 指标 | 口径 | 红线 |
|---|---|---|
| 准点率 | 本周每天实际送达时间 vs 目标时刻 | 误差 >15min 记为不达标 |
| 源健康度 | 各 fetcher 本周成功/空跑/异常次数 | 连续 3 天空跑 → 告警 |
| 去重命中率 | 去重丢弃数 / 采集总数 | 异常高/低都提示 |
| 「元」门禁 | 本周 FAIL 条目数与原因 Top | FAIL 占比 >20% → 检查 fetcher tier |
| AI 摘要抽检 | 随机 3 条人工/规则抽检是否夸大失真 | — |

数据来源：每日运行写一行结构化日志到 `cache/run-log.jsonl`（送达时间、各源条数、门禁结果），周复盘聚合。

---

## 5. 准点送达：调度方案对比（G1）

核心原则：**采集（对时间不敏感）与发送（必须准点）解耦**。

| 方案 | 机制 | 准点性 | 成本/复杂度 | 适用 |
|---|---|---|---|---|
| **A 外部触发 repository_dispatch**（推荐） | cron-job.org / Cloudflare Worker cron 到点带 PAT 调 GitHub API 触发工作流；采集+发送仍在 CI | 高（触发准，CI 启动有 ~1-2min 余量，可接受） | 低（一个免费外部 cron + 一个 PAT） | 想少改动、继续用 CI |
| **B 发送搬出 CI** | 外部常开 worker 到点直接发邮件；CI 只提前采集好存产物 | 最高（零抖动） | 中（需一处常开环境：VPS/Worker） | 对准点要求极严 |
| **C Claude Code /schedule 云例程** | 托管云例程到点触发 | 高 | 低（无需自建调度器） | 已在用 Claude Code 生态 |

**推荐 A**：改动最小、复用现有 CI 与邮件逻辑，只需（1）把 cron-job.org 那条真正配通（PAT + `repository_dispatch` 事件），（2）GitHub `schedule` cron 仅保留为兜底。若日后准点要求升级，再演进到 B。

> 决策点留给评审：**A / B / C 三选一**。本稿默认推荐 A。

---

## 6. 安全整改（G5）

1. **轮换**：Gitee `.workflow/daily-news.yml` 中明文出现的 `MAIL_PASS`、`DEEPSEEK_API_KEY` 视为已泄露 → 立即在各平台重置。
2. **改 secret**：邮箱/密码/Key 全部走 GitHub Secrets / Gitee 环境变量，yml 内不留明文。
3. **清残留**：删除 `>>>>>>> master` 合并冲突标记（该文件当前是坏的）。
4. **历史**：明文密钥已进 git 历史，轮换后即使删文件也无法挽回泄露，**必须以"重置密钥"为准**。

---

## 7. 迁移步骤（分阶段，可增量交付）

- ⬜ **P0 安全**：轮换 Gitee 版明文泄露的邮箱密码与 DeepSeek Key、改 secret、清冲突标记。**（新增）** 另需轮换一枚在沟通中误暴露的 GitHub PAT。
- ✅ **P1 精度（见效最快、改动小）**：`isRelevant` 升级为三态置信度判定（§3.3/A1），标题+描述一起判，裸 claude 降级/丢弃。
  - 落地：commit `9afd852`，`test-relevance.js` 11/11 通过，已推 GitHub。送达端 0 误报仍需连续 3 天抽检（§8）。
- ✅ **P2 准点（已落地+验证通过 · 2026-06-21）**：方案 A 外部 `repository_dispatch` 触发 + 兜底 cron + guard 防双发。
  - 落地：commit `94a60d0`（工作流+guard+`.last-sent`）、`ad39546`（README 准点调度文档）。
  - 验证：cron-job.org Test run → `204` → 约 25s 后产生 `5522242` daily-update commit；`.last-sent=2026-06-21` 写入，今天的兜底将被 guard 跳过（防双发生效）。
  - 待用户：① cron-job.org 启用每日 11:58 Asia/Shanghai 定时；② 连续 3 天验收准点率（§8）。
- ⏸️ **P3 单一基线（暂缓）**：以模块化骨架为壳，把 GitHub v5 的解析/去重/9 源逻辑迁入；GitHub 为唯一线上，Gitee 仅镜像。
  - 暂缓理由：两套代码大合并属高风险重构，会动到每天在跑的线上系统；而 P4 已把「元」纪律直接落在单文件上，P3 的剩余价值主要是架构整洁。建议作为独立任务单独评估、增量迁移，不在当前批次做。
- ✅ **P4 「元」（已落地+验证 · 2026-06-21）**：在线上单文件落地来源分级 + 发送前门禁 + 邮件徽标（按 A1/A4「元可直接加单文件」约定）。
  - 落地：commit `4396394`。`enrichMeta` 打 `source_tier(🟢官方/🟡媒体/🔴社区/⚫无关)`+`relevance`+`provenance`；`processNews §6.2.5` 元门禁（丢 ⚫、🟡缺出处降级、官方永不丢）；HTML/Markdown 加 tier 徽标，🔴⚫ 标「请自行核实」。
  - 验证：`test-tier.js` 分级 7/7 + 门禁丢弃 ⚫；`test-relevance.js` 11/11 无回归；渲染冒烟确认徽标/标注出现。
  - 备注：独立 `validate.js` 模块 + CI 门禁留待 P3 模块化后再抽出；当前为单文件内联门禁。
- ✅ **P5 「监理」（已落地+验证 · 2026-06-21）**：每日 run-log + 周复盘 + 每周工作流。
  - 落地：commit `40a8e34`。主流程每日追加 `cache/run-log.jsonl`（送达时刻/各源条数/元门禁/去重/tier）；`weekly-review.js` 聚合最近 7 天 → 准点率/源健康度/门禁拦截率/去重/tier 分布，写 `archive/review-YYYY-Www.md`，有 GMAIL secret 时邮件发送，红线告警；`weekly-review.yml` 周一定时触发。
  - 验证：合成 7 天数据 `buildReport` 输出正确（准点 5/7、知乎空跑/门禁 35% 告警）；空数据优雅降级；P1 11/11、P4 7/7 无回归。
  - 备注：`run-log.jsonl` 从下次每日运行起累积，首份有效周报需数日数据。

> 图例：✅ 已完成 · 🔄 进行中 · ⬜ 待办。每阶段独立可上线，互不阻塞。

---

## 8. 验收标准

- [ ] 连续 7 天送达时间误差 < 5 分钟（G1）
- [ ] 邮件中无"同名非 Claude-AI"误报（抽检 3 天 0 条裸人名）（G2/精度）
- [ ] 邮件中每条新闻带 tier 徽标，🔴⚫ 有标注（G2）
- [ ] 发送前 `validate` 跑通，FAIL 条目不进邮件、计入日志（G3）
- [ ] GitHub 单一基线运行，Gitee 仅作镜像（G4）
- [ ] 仓库与历史中无明文密钥，密钥已轮换（G5）
- [ ] 首份周复盘报告产出，含准点率/源健康度/门禁统计（G3）

---

## 附录 A：可实施代码与配置

> 约定：**P1 精度**直接改线上单文件 `01-claudenews-main.js`；**P4+** 迁入模块化后同一逻辑放 `src/processor/`。下列代码两处通用。

### A1. 精度补丁（P1 · 改 `01-claudenews-main.js`）

**第一步**：把 `textUtil` 里的 `isRelevant`（约 §2.3，行 ~233）替换为三态判定 + 背向兼容包装：
```js
// 三态相关性：high=确信 Claude-AI / low=裸 claude 疑似人名 / none=无关
relevanceLevel(title, desc = '') {
  const text = `${title} ${desc}`;
  const t = text.toLowerCase();
  const hasAnthropic = t.includes('anthropic') || text.includes('安特罗匹克');
  const hasClaude    = t.includes('claude')    || text.includes('克劳德');
  const aiCtx = /(anthropic|\bai\b|llm|gpt|model|chatbot|大模型|人工智能|对话|助手|opus|sonnet|haiku)/i.test(text);
  if (hasAnthropic)        return 'high';   // anthropic 出现即确信
  if (hasClaude && aiCtx)  return 'high';   // claude + AI 语境
  if (hasClaude)           return 'low';    // 裸 claude（Claude Monet 等人名）
  return 'none';
},
// 媒体源要求 high；社区源可放宽到 low（见下）
isRelevant(title, desc = '') {
  return this.relevanceLevel(title, desc) !== 'none';
},
```

**第二步**：收紧媒体源、给条目带上相关性级别。改各调用点（已定位行号）：

| 行 | 源 | 改法 |
|----|----|------|
| 621 | HN | `isRelevant(hit.title)` → `relevanceLevel(hit.title, hit.story_text||'') === 'high'` |
| 772 | Google News | `isRelevant(item.title)` → `relevanceLevel(item.title, item.description) === 'high'`（**西方媒体误报主战场，强制 high**） |
| 829 / 871 | 西方媒体 RSS / 其它 RSS | 同上，强制 `=== 'high'` |
| 914 | 知乎 | 社区源可保留 `!== 'none'`，但把级别写进条目 |
| 974 | 微信 | 同知乎 |

并在 push 条目时带上：`relevance: textUtil.relevanceLevel(title, desc)`，供 A3 映射 tier、A4 门禁、A5 复盘统计使用。

> 仅此一处（媒体源强制 high）即可去掉绝大多数"Claude 人名"误报，当天见效，无需等整合。

### A2. 调度方案 A 完整落地（P2 · 准点）

**(1) 改 `.github/workflows/claude-news.yml` 的 `on:`**：
```yaml
on:
  repository_dispatch:        # ← 新增：外部精准触发
    types: [daily-news]
  workflow_dispatch:          # 手动触发保留
  schedule:
    - cron: '58 03 * * *'     # 兜底：UTC 03:58 = 北京 11:58（仅当外部触发挂掉时延迟兜底）
```

**(2) 生成 PAT**：GitHub → Settings → Developer settings → **Fine-grained token**，仅授权 `coding158/claudenews` 仓库的 **Actions: Read and write**（classic token 则勾 `repo` + `workflow`）。

**(3) cron-job.org 配置**（到点打 GitHub dispatch API）：
```
URL:    https://api.github.com/repos/coding158/claudenews/dispatches
Method: POST
Headers:
  Authorization: Bearer <PAT>
  Accept: application/vnd.github+json
  X-GitHub-Api-Version: 2022-11-28
  User-Agent: cron-job
Body:   {"event_type":"daily-news"}
Schedule: 每天 11:58（设 cron-job.org 时区为 Asia/Shanghai）
```
> 触发后 CI 启动有 ~1–2 分钟冷启动余量，落到 G1「±5 分钟」之内。`schedule` 兜底保证外部服务挂掉时仍能（延迟）发出。

**自检**：手动 `curl` 上面的请求一次，应返回 `204`，且 Actions 立刻出现一次 `repository_dispatch` 触发的 run。

### A3. 「元」字段 → tier 映射 + 邮件徽标（P4）

各源默认 tier（在 fetcher push 时打）：

| 源 | source_tier | 理由 |
|----|-------------|------|
| anthropic.com/news、官方 docs | 🟢 | 一手官方 |
| GitHub 官方仓库 release | 🟢 | 一手 |
| NYT/WSJ/TechCrunch 等权威媒体(relevance=high) | 🟡 | 权威二手 |
| Google News/RSS relevance=low | 🔴 | 弱相关，标注 |
| 知乎/微博/Reddit 社区 | 🔴 | 社区转载 |
| relevance=none | （门禁丢弃，不入邮件） | |

邮件渲染加徽标（`renderer/email.js` 或单文件 §7）：
```js
const TIER_BADGE = { '🟢':'🟢官方', '🟡':'🟡媒体', '🔴':'🔴社区/待核', '⚫':'⚫未证实' };
// 每条标题前缀 TIER_BADGE[item.source_tier]；🔴⚫ 追加灰字 "（社区来源/未证实，请自行核实）"
```

### A4. `src/processor/validate.js` 完整实现（P4）

```js
'use strict';
const TIERS = new Set(['🟢', '🟡', '🔴', '⚫']);

function validateItem(item) {
  const errs = [];
  if ((item.relevance || 'none') === 'none') errs.push('relevance=none（无关）');
  if (!TIERS.has(item.source_tier)) errs.push(`source_tier 非法/缺：${item.source_tier}`);
  if (['🟢', '🟡'].includes(item.source_tier) && !item.provenance?.url)
    errs.push('🟢🟡 缺 provenance.url');
  if (!item.responsibility) errs.push('缺 responsibility');
  if (!item.boundary)       errs.push('缺 boundary');
  return errs;
}

// 返回 { passed, failed, stats } —— failed 不进邮件
function validateAll(items) {
  const passed = [], failed = [];
  for (const it of items) {
    const errs = validateItem(it);
    if (errs.length) failed.push({ item: it, errs });
    else passed.push(it);
  }
  const stats = {
    total: items.length, pass: passed.length, fail: failed.length,
    failReasons: failed.flatMap(f => f.errs),
  };
  console.log(`元门禁：${stats.pass} PASS / ${stats.fail} FAIL`);
  return { passed, failed, stats };
}

module.exports = { validateItem, validateAll };
// CI: node -e "require('./src/processor/validate').validateAll(require('./cache/today.json'))"
```
主流程：渲染邮件前 `const { passed, stats } = validateAll(items);` 用 `passed` 发信，`stats` 写日志。

### A5. 「监理」周复盘（P5）

**每日运行追加一行** `cache/run-log.jsonl`（主流程末尾）：
```js
const fs = require('fs');
fs.appendFileSync('cache/run-log.jsonl', JSON.stringify({
  date: new Date().toISOString(),
  sent_at: new Date().toISOString(),        // 实际发送时刻 → 算准点率
  per_source: countsBySource,                // {google:20, hn:3, zhihu:2, ...}
  gate: stats,                               // A4 的 {total,pass,fail,failReasons}
  dedup_dropped: dedupDropped,
}) + '\n');
```

**`src/monitor/weekly-review.js`**（每周一，读最近 7 行聚合）：
```js
const lines = fs.readFileSync('cache/run-log.jsonl','utf8').trim().split('\n').slice(-7).map(JSON.parse);
const TARGET_H = 11, TARGET_M = 58;          // 北京 11:58
const onTime = lines.filter(l => {
  const d = new Date(l.sent_at); // 注意转 Asia/Shanghai
  return Math.abs((d.getHours()*60+d.getMinutes()) - (TARGET_H*60+TARGET_M)) <= 15;
}).length;
// 输出：准点率 onTime/7；各源空跑天数；门禁 FAIL 占比与 Top 原因；去重率
```
报告写入 `archive/review-YYYY-WW.md` 并随当日邮件附带；红线（连续 3 天某源空跑 / FAIL 占比 >20% / 准点率 <5/7）在报告顶部告警。

---

## 附：相关项目经验来源
- 「元」门禁：`mind-body-health-files/tools/validate.py`（source_tier/provenance/responsibility/boundary 强制门）
- 「监理」复盘：`mind-body-health-files/yuan/Meta_Kim_*`（监理复盘 + 条件自适应开关）
- CI 门禁模式：`mind-body-health-files/.github/workflows/validate.yml`
