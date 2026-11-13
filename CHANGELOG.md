# 更新记录

## 0.1.11

侧栏改成双环加供应商标志，只列本机配置过的提供商，并补上设置页。

### 双环与标志

- 内环画最短周期（如 5 小时），外环画最长周期（如 1 周）；只有一个周期时只画外环。中心是供应商标志：Codex、Claude 用 simple-icons 的单色路径，Grok、OpenCode Go、GLM 是手绘线条。
- 没有数字的周期保留虚线轨道，不画弧。之前占位环（宿主返回 `fraction: null`）会画出实线轨道，看起来像 0%，现在用 `percentOf()` 判断，虚线轨道照旧。

### 只显示已配置的提供商

- 新增 `src/detect.js`：用 `ctx.get('llm', false)` 读 `LlmRuntime.listProviders()`，按路由名（`codex`、`anthropic`/`claude`、`opencode`、`zhipu`/`z-ai`/`glm`、`grok`/`xai`）对到五家。取不到 `llm`、抛错或返回值不是数组时返回 `null`，表示「不知道」，此时不隐藏任何人。
- `snapshot()` 多返回 `detected`（命中的路由）与 `visible`（要显示的行）；`toDisplay()` 只给 `visible` 生成 rows。`refreshAll` 也只刷这几家，不再为没配置的提供商起请求。
- 本机实测：路由是 `deepseek-official`、`deepseek-account`、`strata`、`opencode-go`、`agentspace`、`openai-codex`，映射后只出 Codex 与 OpenCode Go 两组环。

### 设置页

- 注册 `settings.section`（order 60，标题「额度圆环」）和 `settings.section.icon`。页内四段：实时读取开关、检测到的路由、当前显示的每组环与状态（可刷新、可停用）、GLM 与 OpenCode Go 的密钥输入（只在钥匙串里落盘，不回显）。
- 侧栏与设置页共用同一份内存状态，开一次读五分钟内复用，不用两边各打一次接口。

### 其他

- 侧栏状态句继续放在视觉隐藏的 `aria-live` 区，不占环旁边的宽度。
- `tests/client.test.mjs` 按新界面重写（自带 mini-React，展开纯函数子组件后断言真实 SVG 属性）；`tests/remote.test.mjs` 的方法列表补上 `setLiveReads`。`node --test tests/*.test.mjs` 60 项通过。

## 0.1.10

修好了实机上的两个问题：侧栏不出现圆环，以及出现之后五个环全是 `?`。

### 圆环完全不出现

- 客户端 `apply()` 里读 `ctx.locale`，但模块只声明了 `inject: ['slots', 'remote']`。Cordis 的服务代理在读取未注入的服务键时直接抛错，`?.` 拦不住，异常从 `apply()` 抛出，后面的 `ctx.slots.inject('sidebar.footer.action', …)` 根本没执行，页面上只在控制台留一条 `cannot get property "locale" without inject`。改为先 `ctx.get('locale', false)` 取服务，取不到就退回内置文案。
- `mountRemote()` 里读 `ctx.remote.quotaRings` 同样越权。这个 namespace 是插件自己 `$mount` 出来的，不能写进模块级 `inject`（那会等自己，永远等不到），改为挂载后用 `ctx.get('remote.quotaRings', false)` 轮询取服务。

### 五个环全是 `?`

- 宿主 `liveReads` 默认 `false`，而界面上根本没有打开它的入口，所以装完永远是占位环。新增 `quotaRings.setLiveReads` 端点（`src/service.js`、`src/remote.js`）和面板里的「开启实时读取 / 关闭实时读取」按钮。
- 切换时清掉未停用的缓存并立即重刷；调用带 4 秒超时兜底，宿主不响应就恢复按钮状态并提示。
- 宿主版本不认这个可选端点时，客户端退回只挂 6 个核心方法，按钮隐藏，不会因为按钮消失把整组圆环一起弄没。

### 圆环旁边的竖排文字

- 状态句原来是一个 flex 行子项，被挤成一字宽逐字换行。改成视觉隐藏的 `aria-live` 区域，只在读屏器里播报，界面不再出现那段竖排文字。

## 0.1.9

- 修掉「注册槽位前抛异常」的两处注入问题（即上面 0.1.10 的前两条）。

更早的版本没有逐条记录。
