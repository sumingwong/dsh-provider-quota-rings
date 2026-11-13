# 数据来源

这里只记录已经核对过的事实。没有实测过的账号读数都标成未知，不估算。

## 宿主

- 参考树：内部开发检出，包版本 0.2.0-rc.2，目录里没有 `.git`，完整提交号未知。
- 已安装应用：`/Applications/DeepSeek Harness.app`。当前 `Info.plist` `CFBundleShortVersionString` 是 `0.2.2-rc.2`，`CFBundleIdentifier` 是 `com.deepseek.dsh`。`app.asar` 文件 SHA256 是 `1535941c163698d68a0cf45dd06e1ce1a18a308108d9b84076074f35a6e9c39d`。asar 内含版本 `0.2.2-rc.2` 和构建串 `a6b1b85f44891ee1484bed6a9fc08acaae777d90`。后续验收按这个安装版，不重装旧 0.2.1。0.2.0 参考树和旧 0.2.1 字节不能直接证明当前网关、唤醒、日志或运行时。
- 挂载点是 `sidebar.footer.action`。参考实现见 `packages/client/ui-sidebar` 和 `packages/extensions/ui-cordis/src/client/index.ts`。macOS 收起侧栏时整列隐藏，圆环不单独保留。
- 外部界面沿用装饰模板：`window.__ModuleLoader__.load`，不用对话输入框上方的装饰位。
- 命令定义见 `packages/interaction/commands/src/index.ts`。`recordInput: false` 会省略 `command/run` 的参数，但 `settle()` 仍把结果文本写入 `command/done`。侧栏从 0.1.2 起不再调用 `commands.execute`。
- 客户端挂载见 `packages/api/gateway/src/client/index.ts` 的 `$mount`。`requireStrictInputs` 要求参数和结果的 `codec.mode` 为 `strict`。稳定名字清单在 `packages/api/remotes/src/client/index.ts`，本插件不在其中，所以由侧栏自己 `$mount`。
- 宿主分发见 `packages/api/gateway/src/index.ts` 的 `resolveDescriptor`。`typert.local` 没有这条端点时，回落到带 `typertRemote` 和原型标记的服务。标记键是 `@deepseek-ai/dsh-typert-protocol/remote-methods`。语音先例在 `packages/experimental/api-speech-to-text/src/index.ts`，客户端挂载先例在 `packages/experimental/client-ui-voice-input/src/client/mount.ts`。这两处都没有在已安装的 0.2.2-rc.2 里用本插件跑过。
- 参考树 `apps/desktop/src/main.ts` 的 `powerMonitor` `resume` 只调用策略检查和更新检查。安装版 0.2.2-rc.2 的 `app.asar` 里仍是 `powerMonitor.on("resume", automaticCheck)`，没有 `dsh/power`，也没有 `type: 'power'`。`apps/desktop-host/src/index.ts` 的父进程消息只处理 `shutdown`、`quit-inspection` 和 `update-tasks`。拟议 diff 在 `docs/host-wake-proposal.md`，宿主部分未应用。插件会订阅 `dsh/power`（若宿主将来发出），并仍接受注入的 `powerMonitor`。单元测试和空订阅都不能代替真机休眠。

## Codex

- 本机命令是 `codex`，版本写在 `evidence/`。
- 读取方法是 `account/rateLimits/read`。官方说明在 <https://developers.openai.com/codex/app-server>。供应商二进制里能找到这个方法名。
- `usedPercent` 表示已用。剩余比例是 `1 - usedPercent / 100`。缺字段就保持未知。
- `secondary: null` 不补一个 5 小时窗口。
- `credits.balance` 是金额，不画圆环。
- `accountId` 不进入界面和命令结果。
- 二进制只从固定绝对路径启动。macOS 是 `/opt/homebrew/bin/codex`、`/usr/local/bin/codex`；Windows 是 `%LOCALAPPDATA%\Programs\codex\codex.exe`、`%APPDATA%\npm\codex.cmd`、`%ProgramFiles%\codex\codex.exe`、`%USERPROFILE%\AppData\Local\Programs\codex\codex.exe`，不会扫描 `PATH` 找入口。`.exe` 直接 `spawn`；`.cmd`/`.bat` 按 Node 的 Windows 规则不是 PE 可执行文件，必须经系统固定路径 `%SystemRoot%\System32\cmd.exe`，参数固定为 `/d /s /v:off /c`，命令串整体加引号并只允许固定 `app-server` 参数；PATH 只加入已存在的固定 Node 位置或 shim 同目录的 `node.exe`，找不到就返回 `codex-node-missing`。Windows 只用虚构路径和假进程测过，没有在 Windows 实机运行。
- 传输是本地 `codex app-server` 的 stdio JSON-RPC：`initialize`、`initialized`、`account/rateLimits/read`，然后关掉进程。除方法名以外的握手字段没有用真实进程核对。默认 `liveReads` 为 false，测试只用假进程。

## Claude

官方管理接口 `GET /v1/organizations/usage_report/messages` 和 `GET /v1/organizations/usage_report/claude_code` 要管理员密钥，返回的是历史用量，不是个人 Pro/Max 订阅剩余。速率剩余头只出现在推理响应里；本插件不发推理。`/cost` 是会话费用。

只读核对了 OpenBot 0.61.0（PolyForm-Noncommercial-1.0.0）的调用链，**没有复制其代码**：

- `src/backend/claude-client.ts` 约 319-328 行：`ClaudeQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET`
- 同文件约 696-728 行：`query()` 之后调用该方法，参数 `{ skipBehaviors: true }`
- 同文件约 2282-2294 行：当 `rate_limits_available === true` 时读 `rate_limits.five_hour` / `seven_day`

本插件的独立实现在 `src/providers/claude.js`：可注入 `queryFactory`，否则动态 `import('@anthropic-ai/claude-agent-sdk')`。没有把该 SDK 加成依赖，也没有 `npm install`。`liveReads` 默认 false 时不调用。本机没有该 SDK 时返回 `sdk-missing`。最小依赖是与 OpenBot 0.61.0 `package.json:421` 相同的 `@anthropic-ai/claude-agent-sdk@0.3.309`；建议安装命令 `npm install @anthropic-ai/claude-agent-sdk@0.3.309`，本轮未执行。字段按 `five_hour` / `seven_day` 自行映射。`utilization` / `percent` 按 0–100 解释：1 是 1% 已用、99% 剩余，不是 100%。0、0.2、1、25、100 都用虚构 fixture 覆盖，负数和大于 100 视为未知。这不是已接通的账号读取。

## OpenCode Go

官方说明在 <https://opencode.ai/docs/go/>。页面把用量放到控制台，没有把它写成稳定只读接口。推理响应里的 `opencode.allowance` 需要一次推理，本插件不发。`opencode stats` 是本地 token 和费用。

OpenBot 0.61.0 `src/backend/opencode-usage.ts` 使用 `GET https://opencode.ai/zen/go/v1/usage`，请求头 `Authorization: Bearer`，响应 `{ usage: { rolling, weekly, monthly } }`，各带 `percent` 和 ISO `resetsAt`；rolling 按 300 分钟。许可证同样是 PolyForm-Noncommercial，本插件没有复制解析器。

独立实现在 `src/providers/opencode.js`：同一 URL，主机白名单只有 `opencode.ai`，`redirect: 'error'`，发送前拒绝 CR/LF。密钥不再来自普通插件配置，而是由详情密码框经 session-free remote 写入本机钥匙串账户 `opencode`；设置文件只记 `opencodeKeyStored` 布尔值，不读 `auth.json`、环境变量或本机数据库。`liveReads` 默认 false 时不请求。`percent` 按 0–100 解释：1 是 1% 已用、99% 剩余。rolling 和 weekly 进模型圆环，monthly 标成工具月额度。没有密钥或未授权时保持实验性失败，不是接通。

## Grok

没有已核实的插件读取路径。稳定状态是「暂无法读取」，链接为 <https://grok.com>。不把这个状态当成成功，也不轮询重试，不用 ACP 或 API 余额代替。

## GLM

官方脚本固定提交 `0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254`：

<https://raw.githubusercontent.com/zai-org/zai-coding-plugins/0446d0bb0bc537d97d3ab3664c4b8b9c4a0e1254/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs>

已核对的行为：

- 额度接口是 `GET /api/monitor/usage/quota/limit`，不附带 model-usage 的时间查询参数。
- `Authorization` 是原始密钥，不是 `Bearer`。
- 插件允许的主机只有 `api.z.ai` 和 `open.bigmodel.cn`。官方脚本的允许名单里还有 `dev.bigmodel.cn`，插件不放行，也不是第三组圆环。
- 请求使用 `redirect: 'error'`，并且再次核对最终地址。缺 `limits`、空 `limits` 都不算新成功。
- 429 的 `Retry-After` 可以是秒数或 HTTP 日期。无法解析时保守等待 15 分钟，不把原始头写进界面。
- `TOKENS_LIMIT` 被脚本标成 `Token usage(5 Hour)`，百分比按已用。5 小时来自这个标注，不是另猜的字段。
- `TIME_LIMIT` 被标成 `MCP usage(1 Month)`，属于工具月额度。脚本没有给出周窗口或重置时间；响应里真有 `resetsAt`、`resetAt` 或 `resetTime` 才原样保留。`TOKENS_LIMIT` 和 `TIME_LIMIT` 不读取 `nextResetTime`。
- 官方脚本没有定义 `CREDIT_LIMIT`，也没有说明它的周期，更没有定义 `currentValue`、`usage`、`remaining` 的业务含义。插件把 `CREDIT_LIMIT` 标成“积分（周期未知）”：保留上游 `percentage`；原始字段只按 `currentValue`、`usage`、`remaining` 三个名字展示，不再推断“已用/总量”，不映射成 token、MCP 或模型周期，也不进圆环。
- E2E 报告记录的 2026-11-13 真实只读响应里，两条 `CREDIT_LIMIT` 的 `unit` 都是空，`number` 是 5 和 1，`nextResetTime` 只在第二条出现且是毫秒 epoch `1794541841984`。插件不按 `number` 猜小时或月份；`nextResetTime` 只用于 `CREDIT_LIMIT`，只接受 `1e12` 到 `8.64e15`（JavaScript `Date` 上界）之间的有限毫秒数。缺失、字符串、小于 `1e12` 的秒数、负数、`8.64e15 + 1` 或更大值不会直接采用，会回退到旧的 `resetsAt`/`resetAt`/`resetTime`。旧字段沿用既有有限数字解析；`-1`、`0` 会格式化为早期纪元，只有非有限数字或无效 `Date` 才保持未知。共享的重置格式化器也会把非法日期显示为未知，单条坏数据不会拖垮整个结果。每条有独立 id 和带序号的标签，两条同类不会互相覆盖。
- 其他类型进入详情，范围标成未知，不进圆环。
- 429 只读取这一家的 `Retry-After`。

本回合没有携带密钥访问这个接口。
