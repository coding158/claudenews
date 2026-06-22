/**
 * 编排（Profile）—— GitHub 侧。运行端与角色解耦，靠 PROFILE 切换正/反向。
 *   collect（默认）：采集海外源 → 写 news.json（由 workflow 推到 Gitee 消费）—— GitHub 的主职责
 *   consume       ：读 news.json → 处理 → Gmail（反向：国内采集端把 news.json 推来这里发 Gmail/X）
 */
'use strict';

module.exports = {
  collect: {
    描述: '采集海外源 → AI摘要 → 写 news.json（推 Gitee 消费）',
    sources: ['hackernews', 'reddit', 'github', 'anthropic', 'googlenews', 'westernrss', 'chineserss', 'zhihu', 'weixin'],
    gate: true,        // 轻门禁：相关性(丢 none)+时间窗+标题去重；不做历史去重
    summarize: true,   // 在海外端用 GitHub Models(免费)生成摘要，随 news.json 带给国内，省 Gitee 的 DeepSeek
    process: false,
    render: false,
    sinks: ['wire-out'],
  },

  consume: {
    描述: '读 news.json → 处理 → Gmail（反向）',
    sources: ['newsjson'],
    process: true,     // 完整 processNews（历史去重/补充/排序/限量），复用 live 逻辑
    render: true,
    sinks: ['email-gmail', 'x'],
  },
};
