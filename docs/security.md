# 安全边界（0.1.5）

这是本插件自己的安全说明，不是第三方审计结论，也不表示所有审查项已关闭。

## 密钥存储

- GLM 和 OpenCode Go 的 token 有两个来源：用户自己填的只存在本机钥匙串，账户分别是 `glm` 和 `opencode`，服务固定为 `dsh-provider-quota-rings`；没填时回退到宿主凭据服务：先按匹配到的路由 id 推出引用名（`opencode-go` → `OPENCODE_GO_API_KEY`）调 `resolve`，再找 `llm-pi-ai/<路由 id>` 且类型为 `api-key` 的记录。只取字符串值。
- `settings.json` 只保存 `glmKeyStored` / `opencodeKeyStored` 布尔值，不保存 token。
- 客户端提交 token 时走 session-free remote，方法分别是 `storeGlmKey` 和 `storeOpenCodeKey`。命令结果、remote DTO、错误文本和设置文件在测试里都断言不含虚构 token。
- 宿主凭据的值读出来只交给对应的额度请求头。不写盘、不进 `settings.json`、不进命令结果和 remote DTO、不进日志；凭据服务读不到、引用未设置或记录不是 `api-key` 时当作没有密钥。
- 引用名是插件按路由 id 拼出来的，不是从宿主配置里读的：拼错的引用取不到值，宿主自己配了别的名字（`apiKeyEnv` 写别的）时这条回退就不会命中。
- 不读取 `auth.json`、`.env`、环境变量里的服务商密钥，也不读取其他工具的凭据。

## macOS 助手

`native/keychain.swift` 的 get/set/delete 需要同时满足：

1. 父进程代码签名有效，标识是 `com.deepseek.dsh` 或其前缀，Team 是 `NAN929V4UM`。这里用 `SecCodeCopyGuestWithAttributes` + `SecCodeCheckValidity`，不再用可伪造的路径子串。
2. 服务必须正好是 `dsh-provider-quota-rings`，账户必须在 `glm`、`opencode` 之内。其他条目返回 `not-allowed`。
3. stdin 最大 16 KiB，读取时按 4 KiB 分块并在超过阈值时立即停止，不先分配任意大输入；超限返回 `bad-request`，不解析、不落盘。
4. 每次 get/set/delete 都把操作、账户、结果、pid/ppid/时间写到 stderr，stdout 只给调用结果。get 之外不返回 secret。

`ping` 不检查调用者，用于构建后的非秘密自检；它不读也不写钥匙串。

### 残余信任域

同一用户、同一份已签名 DeepSeek Harness 里的其他插件仍然拥有相同的代码签名身份。上面的服务/账户白名单能阻止它们通过本助手读取别家条目，但不能在纯插件架构里提供插件之间的强隔离。要真正区分插件调用者，需要宿主提供每个插件独立的 capability 或独立签名进程；当前没有这样的接口，也没有改宿主。这个限制保持开放，不声称已经做到绝对隔离。

## OpenCode Go 网络

- 只请求 `https://opencode.ai/zen/go/v1/usage`。
- 固定 `redirect: 'error'`，响应最终 URL 仍做主机和路径白名单检查。
- 发送前拒绝 header 名或值里的 CR/LF，错误码 `unsafe-header`，不会发出请求。
- token 只放在 `Authorization: Bearer`，错误信息会脱敏。

## 验证范围

已用虚构 fixture、内存 secret runner、假 fetch 和假进程验证了上述插件的代码路径；Windows DPAPI 未在 Windows 实机运行，macOS 助手只做了 `ping`、16 KiB 边界、超长坏请求和编译，没有执行真实钥匙串 get/set/delete。安装版 0.2.2-rc.2 的真实网关和真实账号仍未验证。
