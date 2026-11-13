# 更新记录

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
