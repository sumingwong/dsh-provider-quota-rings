# dsh-provider-quota-rings

DeepSeek Harness 会话标题旁的订阅额度圆环插件：内环是最近一个周期（例如 5 小时），外环是最长的周期（例如一周），中心是供应商标志。标题栏只画环，用量在悬停卡片里。安装、配置和数据结构见 [README.md](./README.md)。

## Agent skills

### Issue tracker

议题和规格说明放在 GitHub Issues 里，用 `gh` CLI 读写。见 `docs/agents/issue-tracker.md`。

### Triage labels

分诊的五个规范角色沿用默认标签字符串。见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局：根目录一份 `GLOSSARY.md`，架构决定放 `docs/adr/`。见 `docs/agents/domain.md`。
