# news.json 数据交换 Schema (v1)

海外采集层（GitHub Action，本仓库 `collect-to-json.js`）产出 → push 到 Gitee 仓库
`coding158/claude-news-daily` 根目录 → Gitee Go 在国内读取消费（去重 / DeepSeek 摘要 / 139 发信）。

> 两端必须按同一 schema 对接。改字段时同步改两边并升 `schemaVersion`。

## 顶层结构

```jsonc
{
  "schemaVersion": 1,
  "generatedAt": "2026-06-21T02:00:00.000Z",   // 采集时间，ISO8601 UTC
  "source": "github-actions/claudenews",        // 产出方标识
  "count": 42,                                    // items 数量
  "items": [ /* NewsItem[] */ ]
}
```

## NewsItem

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `title` | string | ✓ | 标题 |
| `url` | string | ✓ | 原文链接 |
| `description` | string |  | 摘要 / 正文片段（≤500 字） |
| `source` | string | ✓ | 来源名，如 `The Verge` / `Anthropic Official` / `Hacker News` |
| `publishedAt` | string |  | 发布时间，ISO8601 UTC |
| `category` | enum |  | `official` \| `western_media` \| `chinese_media` \| `community` \| `project` |
| `isOfficial` | bool |  | 是否官方公告（消费侧置顶、永不被过滤） |
| `points` | number |  | 热度 / 分数 |
| `commentsCount` | number |  | 评论数 |

## 消费侧字段映射（Gitee 内部中文字段）

`url→链接`，`publishedAt→发布时间(Date)`，`isOfficial→是官方`，`points→热度`，`commentsCount→commentsCount`，
`category→分类`：
- `official` → `官方`（且 `是官方=true`）
- `western_media` / `chinese_media` → `科技媒体`（命中后按相关性可评 🟡 权威媒体）
- `community` → `国内社区`
- `project` → `开源项目`

## 约定

- 采集层只做「采集 + 相关性门禁（丢 `none`）+ 时间窗（近 7 天）+ 轻去重」；
  **历史去重 / AI 摘要 / 分组 / 渲染 / 发信全部在消费侧（Gitee）做。**
- 消费侧读不到 `news.json` 时应优雅降级（视为 0 条，不报错崩溃）。
- 两边 push 到 Gitee 都带 `[skip ci]`，避免触发 Gitee Go 的自动构建（它只按 11:58 定时跑）。
