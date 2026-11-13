# 订阅额度圆环

DeepSeek Harness 侧栏底部的订阅额度圆环。圆环越满，剩余越多。只显示这台机器上 DSH 已经配置的模型提供商；环里没有数字时画虚线轨道，不会凑成 0% 或 100%。这是独立实现，没有复制 OpenBot 的源码。

这是本机实测过的开发版本，`client.js` 是手写 JavaScript，仓库里没有上游的 TypeScript 源码。

安装方式是把本目录 `npm pack` 出来的 tgz 加进某个 DSH profile：`package.json` 的依赖写 `"dsh-provider-quota-rings": "file:<tgz 绝对路径>"`，同时把包名追加到同一份 `package.json` 的 `dsh.profile.bundles`。改完宿主代码不用重启整个应用，用插件管理器把 `include:provider-quota-rings` 关掉再打开即可重载宿主侧；页面侧刷新在 macOS 上是 `open -a "DeepSeek Harness" "dsh-app://app/"`。

## 现在能看到什么

- 每组圆环两层：内环是最短周期（例如 5 小时），外环是最长周期（例如 1 周）。只有一个周期时只画外环。中心是供应商标志。
- 侧栏只列宿主检测到的提供商：宿主用 `LlmRuntime.listProviders()` 看这台机器配了哪些模型路由，再按路由名对到 Codex、Claude、OpenCode Go、GLM、Grok。一个都没配到就不占位置。读不到 `llm` 服务时退回全部行。
- 没有读到真实额度时显示「未知」和虚线轨道，不会显示成 0% 或 100%。
- Grok 固定显示「暂无法读取」，并给出 [Grok 官网](https://grok.com)。这不是接通。
- 有两个已知模型周期时，圆环只保留最短和最长的两个。鼠标悬停或键盘聚焦会打开用量面板：顶部是供应商标志和名称，每个周期一行「周期名 / 剩余条 / 剩余百分比 / 距重置时长」，例如「每周 ▓▓▓▓ 剩余 86% · 2 天 11 小时」。缺字段写「未知」。面板只读缓存，不重新请求服务商。
- 点击仍打开完整详情。工具月额度单独标成「工具（月额度）」，不拿来当模型周窗口。数量只在响应里真有数字时出现。
- GLM 在详情里切换「智谱」和「Z.AI」。两边的缓存分开。`CREDIT_LIMIT` 显示为「积分（周期未知）」；`percentage` 原样保留，`currentValue`、`usage`、`remaining` 只按原始字段名显示，不推断已用/总量，不按 `number` 猜小时或月份，也不进圆环。`nextResetTime` 只用于这一类，并且只接受 `1e12` 到 `8.64e15`（JavaScript `Date` 上界）的有限毫秒值；缺失、字符串、秒数、负数或超过上界时会回退到旧的 `resetsAt`/`resetAt`/`resetTime`。旧字段沿用既有有限数字解析：`-1`、`0` 会按早期纪元格式化，只有非有限数字或无法形成有效日期时才显示未知，不影响其它行。
- GLM 和 OpenCode Go 的密钥只从详情里的密码框写入本机钥匙串。OpenCode Go 不再接受普通配置里的明文 token；设置文件只记 `opencodeKeyStored` 布尔值。
- 设置里新增「额度圆环」一页：开关实时读取、列出检测到的路由、逐个提供商刷新或停用、切换 GLM 平台、填 GLM 与 OpenCode Go 的密钥。
- 宿主每五分钟在内存里刷新一次。侧栏挂载后也会每五分钟对 `quotaRings.read` 做一次静默同步，把缓存画到界面，不闪提示，悬停不打服务商。手动刷新、停用、启用、切换平台和保存 GLM 密钥仍走同一条 remote。
- 鼠标从圆环移到卡片时，卡片与按钮重叠 8px，中间还有透明桥接，避免空隙里触发 leave。卡片按视口左右边缘收住，窄侧栏里不会被裁掉。按钮没有原生 `title`，避免和卡片叠一层提示。键盘从圆环 Tab 进卡片时保持打开，焦点离开整行和卡片后才关闭。
- 插件可以接一个注入的 `powerMonitor`，也会订阅宿主若发出的 `dsh/power`。当前安装版 0.2.2-rc.2 的恢复事件只跑策略和更新检查，没有把休眠转给插件，因此短休眠不一定补查。提案在 `docs/host-wake-proposal.md`，没有改宿主。
- 某一家返回 429 时，按它的 `Retry-After` 等待。头缺失或无法解析时，这一家保守等 15 分钟，界面不回显原始头。
- 刷新失败、响应缺 `limits` 或为空时，保留上次成功的数据，并标上时间和原因。实验来源可以单独停用。停用会取消这一家正在进行的请求，圆环不再画旧的有效比例。卸载会清掉定时器和未完成的请求。

## 默认不读账号

`liveReads` 默认是 `false`。这个状态下不会启动 `codex app-server`，也不会请求 GLM、Claude 实验 SDK 或 OpenCode 用量地址。密钥只走本机钥匙串。macOS 助手源码是 `native/keychain.swift`，编译产物是 `bin/quota-keychain`。助手用父进程的代码签名身份（`SecCodeCopyGuestWithAttributes` + `SecCodeCheckValidity`，标识 `com.deepseek.dsh` 族、Team `NAN929V4UM`），不再用路径子串。助手还固定只接受服务 `dsh-provider-quota-rings` 和账户 `glm`、`opencode`，其它条目直接拒绝；每次 get/set/delete 都把操作、账户、结果和进程号写到 stderr 审计。同一用户、同一份已签名 DSH 里的其他插件仍共享这个代码身份，所以这是插件级白名单，不是绝对的插件间隔离。本机编译后只发送 `{"op":"ping"}` 和一条超长坏请求，没有执行 get、set 或 delete。二进制不存在时，存储返回 `keychain-helper-not-built`，不会落成明文文件。

Windows 的 DPAPI 脚本在 `native/dpapi.ps1`，目前还没有和 macOS 助手相同的服务/账户白名单。这台 Mac 上没有运行它。完整边界见 `docs/security.md`。

## OpenCode Go 密钥

OpenCode Go 的 token 不再从插件配置读取，也不会写进 `settings.json`、命令结果、remote DTO 或错误文本。用户在 OpenCode Go 详情里输入后，插件把 token 从客户端经 session-free remote 交给主进程，只写入钥匙串账户 `opencode`；设置文件只保留 `opencodeKeyStored: true`。刷新时才从钥匙串取出，用于 `Authorization: Bearer`，请求仍固定 `https://opencode.ai/zen/go/v1/usage`、`redirect: 'error'`，发送前拒绝 CR/LF。测试使用内存 secret runner 和虚构 token，没有读取 `auth.json`、环境变量或真实钥匙串。

## Claude SDK 依赖

Claude 适配器不新增运行时依赖。要走真实实验接口，最小依赖是 `@anthropic-ai/claude-agent-sdk@0.3.309`（与 OpenBot 0.61.0 `package.json:421` 一致），安装命令是 `npm install @anthropic-ai/claude-agent-sdk@0.3.309`。本轮没有执行安装，也没有启动真实账号。也可以继续注入 `queryFactory`，测试就是这样做。

## 宿主限制

侧栏读取和手动操作调用 `ctx.remote.$mount` 挂上的 `quotaRings`。方法不接收会话。宿主网关在没有生成器登记时，会按服务上的 SRC 标记分发；这条路径不经过 `commands.execute`，因此不会写 `command/done`。`/quota-rings` 命令还在，给手动调用留着；它的 `recordInput: false` 仍然删不掉 `settle()` 写入的结果。参考树是 0.2.0-rc.2。当前安装版是 0.2.2-rc.2（`app.asar` SHA256 `1535941c163698d68a0cf45dd06e1ce1a18a308108d9b84076074f35a6e9c39d`）。自挂契约没有在这个安装版上跑过。旧 0.2.1-rc.5 字节不能证明当前网关。

- 五分钟自动刷新仍在宿主内存里；侧栏另有五分钟静默 `read`。都不走命令，也不在悬停时打服务商接口。
- 没有会话也可以读缓存。不使用会话列表的第一个 id。
- 生成器 `@deepseek-ai/dsh-typert-generator@0.2.0-rc.2` 没有安装。描述符按参考树 `InvocationDescriptor` 手写，`codec.mode` 为 `strict`。
- 系统休眠仍没有转发到插件。提案在 `docs/host-wake-proposal.md`，没有改宿主。
- GLM 密钥只用详情里的密码框提交。不要把它打进对话。remote 的返回值不带密钥。
- Claude / OpenCode Go 有独立的实验适配器，默认 `liveReads=false` 不会发请求。没有把占位标成接通。未复制 OpenBot 的 PolyForm-Noncommercial 代码。Claude 适配器的最小依赖是 `@anthropic-ai/claude-agent-sdk@0.3.309`；没有安装，详见 `docs/sources.md`。Windows Codex 只在 `LOCALAPPDATA`、`APPDATA`、`ProgramFiles`、`USERPROFILE` 的固定位置找 `codex.exe`/`codex.cmd`，不会从 `PATH` 扫描入口。`.exe` 直接启动；`.cmd`/`.bat` 是 npm shim，不能当 PE 执行，改用系统固定路径的 `cmd.exe /d /s /v:off /c`，并把入口、固定 `app-server` 参数和 Node 目录做安全引用，PATH 只加入已存在的固定 Node 位置。Windows 原生还没有实机验证。

## 本地检查

```bash
node --test tests/*.test.mjs
```

不安装依赖。测试不读取本机钥匙串，也不访问四家账号。
