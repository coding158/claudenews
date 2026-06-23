# claudenews
收集claude.ai公司的最新进展情况，包括主要负责人的新闻和产品推广等

> ⚠️ **本 README 是 v5「单文件→Gmail」描述；现已新增"元引擎 + 跨端采集(→ Gitee 139)+ GitHub Models 免费摘要"。当前全貌见 [`CURRENT_STATE.md`](CURRENT_STATE.md)。**（2026-06-23）

<div align="center">

# 📰 Claude News Collector

**自动化的 Claude.ai 与 Anthropic 公司新闻聚合器**

每天 11:58 自动收集全球最新动态，整理成精美邮件直达邮箱，支持 Obsidian 笔记导入

[![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-自动运行-2088FF?logo=github-actions&logoColor=white)](https://github.com/coding158/claudenews/actions)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Version](https://img.shields.io/badge/Version-v5.0-blueviolet)](#)

</div>

---

## 🎯 这个项目能做什么

如果你像我一样，每天想知道 Claude / Anthropic 有什么新动态，但又不想：

- ❌ 手动刷 Hacker News / Reddit
- ❌ 翻墙看 TechCrunch / The Verge
- ❌ 在微信里搜索零散的公众号文章
- ❌ 错过 Anthropic 官方的重大公告

**那这个项目就是为你准备的。**

每天早上 11:58，你的邮箱会收到一封精心整理的"Claude.ai 日报"，包含：

- 🌟 Anthropic 官方公告（最高优先级）
- 🌍 西方主流媒体报道（纽约时报、WSJ、TechCrunch、The Verge 等）
- 🇨🇳 中文科技媒体（机器之心、36氪、量子位、少数派、InfoQ）
- 💬 社区讨论（Hacker News、Reddit、知乎）
- 🐙 GitHub 热门项目（最近一周高 star 的相关仓库）

而且，**已经推送过的内容不会再次出现** —— 每天只看真正的新东西。

---

## ✨ 核心特性

### 📡 9 个数据源全方位覆盖

| # | 数据源 | 类型 | 说明 |
|---|--------|------|------|
| 1 | Anthropic 官方 | 🌟 官方 | 最重要的新品发布和公告 |
| 2 | Google News RSS | 🌍 聚合 | 自动覆盖纽约时报、WSJ、Bloomberg 等所有主流媒体 |
| 3 | 西方媒体 RSS | 🌍 媒体 | TechCrunch、The Verge、Ars Technica、Wired、MIT Tech Review、VentureBeat |
| 4 | 中文媒体 RSS | 🇨🇳 媒体 | 机器之心、36氪、量子位、少数派、InfoQ 中文 |
| 5 | Hacker News | 🟠 社区 | 技术圈最权威的讨论 |
| 6 | Reddit | 🔴 社区 | r/ClaudeAI + r/Anthropic 高赞帖 |
| 7 | 知乎 | 🇨🇳 社区 | 中文优质回答和文章 |
| 8 | 搜狗微信 | 🇨🇳 公众号 | 微信公众号文章（反爬严格，仅供尝试） |
| 9 | GitHub | 🐙 项目 | 最近一周活跃的 Claude 相关项目 |

### 🧠 智能数据处理

- **去重**：基于 Jaccard 相似度算法，自动合并多家媒体报道的同一新闻
- **过滤**：只保留最近 7 天的内容，自动过滤无关信息
- **排序**：官方优先 + 时间倒序，重要内容置顶
- **分组**：按"今天 / 昨天 / 本周早些时候"清晰分组

### 🚫 历史去重（v5 新功能）

- **14 天滚动窗口**：已推送过的内容不再重复
- **持久化存储**：历史记录自动 commit 回仓库
- **智能补充**：新内容不足时自动补充优质历史，避免邮件太空
- **自动清理**：14 天前的过期记录自动删除

### 📧 双格式输出

- **HTML 邮件**：精美的视觉设计，响应式布局，手机电脑都好看
- **Markdown 附件**：标准 Frontmatter，可直接拖入 Obsidian 知识库

### 🔧 工程化设计

- ✅ `fast-xml-parser` 处理各种 RSS/Atom 格式
- ✅ `p-limit` 控制并发，对外网友好
- ✅ `AbortController` 标准超时处理
- ✅ 指数退避重试机制
- ✅ 时区统一为 `Asia/Shanghai`
- ✅ 完善的错误捕获和日志输出

---

## 🚀 快速开始（10 分钟部署）

### 前置条件

- 一个 GitHub 账户（免费）
- 一个 Gmail 邮箱（用于发送和接收）

### 第 1 步：获取 Gmail 应用密码

1. 访问 [Google 账号安全设置](https://myaccount.google.com/security)
2. 启用 "2 步验证"
3. 进入 "[应用专用密码](https://myaccount.google.com/apppasswords)"
4. 生成一个新密码（16 位，格式如 `xxxx xxxx xxxx xxxx`）
5. **复制保存好**

### 第 2 步：Fork 或创建仓库

**方式 A：Fork 本仓库**（推荐）

点击右上角 Fork 按钮即可。

**方式 B：新建仓库**

1. 访问 [github.com/new](https://github.com/new)
2. Repository name：`claudenews`
3. Visibility：Public
4. 创建后，把本项目的代码复制进去

### 第 3 步：配置 GitHub Secrets

进入仓库的 **Settings → Secrets and variables → Actions**

添加 3 个 Secrets：

| Secret 名 | 值 | 说明 |
|----------|-----|------|
| `GMAIL_USER` | `your-email@gmail.com` | 你的 Gmail 地址 |
| `GMAIL_APP_PASSWORD` | `xxxx xxxx xxxx xxxx` | 上一步获取的 16 位应用密码 |
| `EMAIL_RECIPIENT` | `your-email@gmail.com` | 收件人地址（可以和 GMAIL_USER 相同） |

### 第 4 步：检查 `.gitignore`

确保 `.gitignore` 中**没有** `cache/` 这一行（v5 需要持久化历史到仓库）。

如果有，请删除。

### 第 5 步：手动触发首次运行

1. 进入仓库的 **Actions** 标签
2. 选择 "Claude News Collector"
3. 点击 **Run workflow** → **Run workflow**
4. 等待约 30 秒
5. 检查 Gmail 收件箱 ✅

### 第 6 步：等待每日推送

之后每天上午 11:58（北京时间）会自动运行。

> ⚠️ 仅靠 GitHub `schedule` cron 送达时间**不固定**（实测可延迟 6+ 小时）。要精准 11:58，请配置下面的「准点调度」。

---

## ⏰ 准点调度（让送达时间固定在 11:58）

### 为什么需要
GitHub Actions 的 `schedule:` cron 是「尽力而为」，高峰期会延迟数十分钟到数小时甚至跳过，导致每天送达时间漂移（实测最多晚 6+ 小时）。要精准送达，必须由 **CI 之外的触发器** 在固定时刻打 GitHub 的 `repository_dispatch` API。

### 调度架构（本仓库工作流已内置）
| 角色 | 机制 | 时间 |
|------|------|------|
| **主触发（准点）** | 外部 cron-job.org 到点 → `repository_dispatch[daily-news]` → 工作流 | 11:58 北京（精准） |
| **兜底** | GitHub `schedule` cron，仅当外部触发挂掉时补发 | 15:00 北京（会延迟） |
| **防双发** | workflow 的 `guard` 步骤：当天若已成功发过（`.last-sent`==今天）则跳过兜底 | — |

> 不配置外部触发也能用，但只走延迟兜底；配置后才精准。

### 配置步骤（一次性）

**① 生成 PAT**：GitHub → Settings → Developer settings → **Fine-grained tokens**
- Repository access：仅选 `coding158/claudenews`
- Permissions：**Contents = Read and write** + **Metadata = Read**（经典 token 则勾 `repo`）

**② 配置 [cron-job.org](https://cron-job.org)**（免费，注册后新建 cronjob）
```
URL:    https://api.github.com/repos/coding158/claudenews/dispatches
Method: POST
Headers:
  Authorization: Bearer <你的PAT>
  Accept: application/vnd.github+json
  X-GitHub-Api-Version: 2022-11-28
  User-Agent: cron-job
Body:   {"event_type":"daily-news"}
时区:   Asia/Shanghai，每天 11:58
```

**③ 自测**（在自己的终端运行，**勿把 PAT 贴到公开处**）：
```bash
curl -i -X POST -H "Authorization: Bearer <PAT>" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/repos/coding158/claudenews/dispatches \
  -d '{"event_type":"daily-news"}'
```
返回 **`204 No Content`** 即成功；GitHub **Actions** 标签会立刻出现一次 `repository_dispatch` 触发的运行。

### 验收
连续 3 天确认：① 送达时间在 11:58±5 分钟；② 每天只有一封（`guard` 防住兜底双发）。

---

## 📂 项目结构

```
claudenews/
├── .github/
│   └── workflows/
│       └── claude-news.yml          # GitHub Actions 工作流
├── cache/
│   └── history.json                 # 历史记录（自动管理，请勿手动修改）
├── 01-claudenews-main.js            # 主程序（单文件，分 9 个 section）
├── package.json                     # Node.js 依赖
├── .gitignore                       # Git 忽略规则
└── README.md                        # 本文件
```

### 主程序内部结构

`01-claudenews-main.js` 虽然是单文件，但内部清晰分为 9 个 section：

```javascript
// §1  常量配置        - 所有可调参数集中管理
// §2  工具层          - logger / time / text / fetch with retry
// §3  解析层          - XML/RSS / Google News URL decoder
// §4  缓存层          - history.json 读写与清理
// §5  采集层          - 9 个数据源的采集函数
// §6  处理层          - 去重 / 过滤 / 排序 / 分组
// §7  渲染层          - HTML / Markdown 双格式
// §8  邮件层          - Gmail SMTP 发送
// §9  主流程          - 串起整个 pipeline
```

---

## ⚙️ 自定义配置

### 修改运行时间

**准点时间**由外部触发器决定 —— 改 [cron-job.org](https://cron-job.org) 那个 cronjob 的时间即可（见上面「⏰ 准点调度」）。

**兜底时间**在 `.github/workflows/claude-news.yml` 的 `schedule`，它只在外部触发挂掉时生效、且会被 GitHub 延迟，因此设得晚于主触发：

```yaml
schedule:
  - cron: '0 7 * * *'   # UTC 07:00 ≈ 北京 15:00（兜底，会延迟）
```

Cron 表达式参考（UTC）：
- `'00 02 * * *'` = 北京时间 10:00
- `'00 12 * * *'` = 北京时间 20:00

工具：[crontab.guru](https://crontab.guru/)

### 修改时间窗口

编辑 `01-claudenews-main.js` 顶部的 `CONFIG`：

```javascript
const CONFIG = {
  daysToKeep: 7,         // 显示最近几天的新闻
  historyDays: 14,       // 历史记录保留几天
  maxNewsItems: 50,      // 邮件最多展示几条
  concurrency: 4,        // 同时并发请求数
};
```

### 修改数据源

每个数据源都是独立的 `fetchXxx()` 函数，在 `§5 采集层`。

**禁用某个源**：在主流程 `main()` 里把对应函数注释掉。

**添加新源**：参考现有函数的格式，新增一个 `fetchXxx()` 并加入 `Promise.allSettled` 数组。

### 修改邮件样式

`§7 渲染层` 的 `renderHTML()` 函数。

颜色定义在 `getBorderColor()`：

```javascript
function getBorderColor(item) {
  if (item.isOfficial) return '#f59e0b';        // 橙色 - 官方
  if (item.category === 'chinese_media') return '#ef4444';  // 红色 - 中文
  if (item.category === 'western_media') return '#3b82f6';  // 蓝色 - 西方
  return '#667eea';                             // 紫色 - 其他
}
```

---

## 📊 邮件预览

每天收到的邮件大致是这个结构：

```
═══════════════════════════════════════════
   📰 Claude.ai 日报
   2026-05-20 · 15 条 (已自动去除历史推送)
   🌟 官方:2  🌍 西方:5  🇨🇳 中文:3
   🟠 HN:4   🔴 Reddit:1  🐙 GitHub:0
═══════════════════════════════════════════

🌟 Anthropic 官方 (2)
─────────────────────────────────────────
  1. Introducing Claude Opus 4.7
     🌟 Anthropic Official · 05-20 11:30
     → 查看详情

  2. Claude for Small Business
     🌟 Anthropic Official · 05-20 09:00
     → 查看详情

📅 今天 (6)
─────────────────────────────────────────
  3. Andrej Karpathy joins Anthropic
     🌍 The New York Times · 05-20 10:15
     ...

📆 昨天 (4)
─────────────────────────────────────────
  ...

📋 本周早些时候 (3)
─────────────────────────────────────────
  ...
```

---

## 🔍 如何验证去重生效

### 方法 1：查看 Actions 日志

进入 Actions → 最近一次运行 → 展开 `Run Claude News Collector`：

```
首次运行:
  ℹ️  首次运行, 未找到历史记录

第二次运行起:
  ✓ 已加载历史记录: 35 条
  ℹ️  历史去重: 42 → 7 新 + 35 重复
```

### 方法 2：查看 cache/history.json

仓库根目录会自动出现 `cache/history.json` 文件，内容示例：

```json
{
  "items": {
    "abc123def456": {
      "firstSeen": 1716198000000,
      "lastSeen": 1716284400000,
      "count": 2,
      "title": "Andrej Karpathy joins Anthropic..."
    }
  },
  "lastRun": "2026-05-20T05:00:00.000Z"
}
```

### 方法 3：观察邮件

连续几天的邮件，**同一新闻不会重复出现**。即使该新闻在 Hacker News 和 Reddit 同时被讨论好几天，你也只会看到一次。

---

## ❓ 常见问题

<details>
<summary><b>Q: 为什么 GitHub Actions 一直显示警告 "Node.js 20 is deprecated"？</b></summary>

工作流文件已使用 `actions/checkout@v6` 和 `actions/setup-node@v6`，这是 2026 年 1 月发布的最新稳定版，原生支持 Node.js 24。如果还看到警告，可能是缓存问题，重新触发一次即可。
</details>

<details>
<summary><b>Q: 报错 "Process completed with exit code 1"</b></summary>

查看 Actions 详细日志：
- 若提示 `Cannot find module`：检查仓库里的 JS 文件名是否和 workflow 中一致
- 若提示 `Authentication failed`：检查 Gmail 应用密码是否正确（16 位）
- 若提示 `paths are ignored by .gitignore`：检查 `.gitignore` 中是否还有 `cache/`，需要删除
</details>

<details>
<summary><b>Q: 收到的邮件里中文媒体内容很少？</b></summary>

正常现象。中文 RSS 源对 Claude/Anthropic 的相关报道频率本身就低于英文媒体。如果某天完全没有，程序会自动从历史中补充优质内容。

如果想增加中文比例，可以：
- 在 `fetchChineseMediaRSS` 中添加更多中文媒体的 RSS 链接
- 把过滤关键词加上更多中文别名（如"克劳德"）
</details>

<details>
<summary><b>Q: 微信公众号经常 0 条？</b></summary>

是的，搜狗微信反爬非常严格，GitHub Actions 的 IP 经常被拦截。这是已知限制，不影响其他数据源。

机器之心、量子位、36 氪 等中文媒体已经覆盖了 90% 的优质中文内容（公众号好文章通常也会在这些平台发布）。

如果你真的需要稳定的微信公众号内容，可以考虑：
- 自建 [RSSHub](https://docs.rsshub.app/)（开源免费，可部署在 Vercel）
- 使用 WeRSS 等付费工具（¥10-30/月）
</details>

<details>
<summary><b>Q: 想清空历史重新开始？</b></summary>

在 GitHub Web 上删除 `cache/history.json` 文件即可。下次运行时会自动重新创建。
</details>

<details>
<summary><b>Q: 想接收到多个邮箱？</b></summary>

修改 `EMAIL_RECIPIENT` Secret 为逗号分隔的多个地址：

```
user1@gmail.com,user2@example.com
```

注意：nodemailer 默认支持，无需改代码。
</details>

<details>
<summary><b>Q: 可以加 AI 摘要吗？</b></summary>

当前 v5 没有 AI 摘要功能。如果需要，可以基于 v5 扩展：

1. 在 GitHub Secrets 添加 `ANTHROPIC_API_KEY`
2. 在 `processNews` 之后调用 Claude Haiku API 给每条新闻生成 1-2 句摘要
3. 预估成本：每天约 ¥0.5-1，每月 ¥15-30
</details>

---

## 🛠️ 技术栈

| 技术 | 用途 | 版本 |
|------|------|------|
| **Node.js** | 运行环境 | 20+ |
| **GitHub Actions** | 自动化调度 | actions/checkout@v6, setup-node@v6 |
| **Gmail SMTP** | 邮件发送 | via nodemailer |
| **fast-xml-parser** | RSS/Atom 解析 | ^4.4.0 |
| **node-fetch** | HTTP 请求 | ^2.7.0 |
| **nodemailer** | 邮件发送 | ^6.9.13 |
| **p-limit** | 并发控制 | ^3.1.0 |

---

## 📈 版本演进

| 版本 | 重点 | 状态 |
|------|------|------|
| v1.0 | 基础雏形：HN + 邮件 | 历史版本 |
| v2.0 | 修复脚本崩溃，添加错误处理 | 历史版本 |
| v3.0 | 时间过滤 + 时间分组 | 历史版本 |
| v4.0 | 西方媒体 + 中文媒体（9 数据源） | 历史版本 |
| **v5.0** | **工程化 + 历史去重缓存** | **当前** ⭐ |
| v6.0 | AI 摘要 + 智能分类（未开发） | 规划中 |

---

## 🚦 已知限制

- ⚠️ **搜狗微信**：反爬严格，结果常为 0 条
- ⚠️ **首次运行**：历史为空，所有内容都是"新"的，从第二天起去重生效
- ⚠️ **Google News URL**：部分链接是重定向链接，点击会跳转到真实媒体
- ⚠️ **GitHub Actions cron 不准**：`schedule` 调度高峰期可延迟数十分钟到数小时（实测 6+ 小时）。要精准 11:58 须配置「⏰ 准点调度」（外部 `repository_dispatch` 触发）
- ⚠️ **节假日**：GitHub 偶尔有维护，可能影响某天的运行

---

## 🔐 隐私与安全

- ✅ 所有敏感信息（Gmail 密码）通过 [GitHub Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets) 加密存储
- ✅ 使用 Gmail **应用专用密码**，可随时撤销，不影响主账户
- ✅ 代码完全开源，可审计
- ✅ 不收集任何用户数据
- ✅ 所有网络请求都是公开 API，不涉及登录爬取

---

## 📜 许可证

[MIT License](LICENSE)

可以自由使用、修改、分发。

---

## 🤝 贡献

欢迎提 Issue 或 Pull Request：

- 🐛 报告 Bug
- 💡 提出新数据源建议
- ✨ 贡献代码改进
- 📖 改进文档

---

## 💬 致谢

- 感谢 [Anthropic](https://www.anthropic.com/) 创造了 Claude
- 感谢所有提供 RSS / 公开 API 的媒体和社区
- 项目本身就是用 Claude Code 辅助开发的 🤖（ChatGPT也提供了宝贵的意见和建议）

---

<div align="center">

**如果这个项目对你有帮助，欢迎给个 ⭐ Star**

[报告 Bug](../../issues) · [提出建议](../../issues) · [查看运行日志](../../actions)

Made with ❤️ by [coding158](https://github.com/coding158)

</div>
