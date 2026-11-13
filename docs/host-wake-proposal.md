# 宿主唤醒差异提案

状态：**未应用宿主 diff**。本文件只作为提案记录，供宿主维护者评估。插件没有修改 DeepSeek Harness 的源码、安装包或正在运行的进程。

插件侧已经受控订阅 `dsh/power`（`src/power.js` 的 `bindHostPower`）。当前安装壳不会发这个事件，所以这条订阅现在接不到系统唤醒。页面可见性和迟到的定时器都不是系统唤醒。

## 核对到的版本

| 对象 | 事实 | 来源 |
| --- | --- | --- |
| 参考树 | 内部开发检出，包版本 0.2.0-rc.2。目录没有 `.git`，完整提交号未知。下面拟议 diff 的行号按这次阅读的参考源码。 | 只读目录 |
| 当前安装版 | `/Applications/DeepSeek Harness.app`，`Info.plist` `CFBundleShortVersionString` = `0.2.2-rc.2`，`CFBundleIdentifier` = `com.deepseek.dsh` | 本机 2026-11-12 |
| 安装 `app.asar` 文件 SHA256 | `1535941c163698d68a0cf45dd06e1ce1a18a308108d9b84076074f35a6e9c39d` | `shasum -a 256`，主管 2026-11-12T12:16:08Z 独立核对一致 |
| 安装包内 version 字段 | asar 内 `"version": "0.2.2-rc.2"`，并含构建串 `a6b1b85f44891ee1484bed6a9fc08acaae777d90` | 只读扫描 asar 字节，未解包、未改文件 |
| 代码签名 | Identifier `com.deepseek.dsh`，Team `NAN929V4UM`，Authority Developer ID Application: Hangzhou DeepSeek Artificial Intelligence Co., Ltd | `codesign -dv` |
| 旧 0.2.1-rc.5 | 本机已不是这个版本。旧安装字节和 0.2.0 参考树不能直接证明 0.2.2-rc.2 的网关、唤醒、日志或运行时。 | 安装版 asar 中没有 `0.2.1-rc.5` 字符串 |

验收按当前安装版 0.2.2-rc.2。不要为了对齐旧笔记而重装 0.2.1。

## 现在的行为

参考树 `apps/desktop/src/main.ts` 里，`resume` 只跑策略检查和更新检查。安装版 0.2.2-rc.2 的 `app.asar` 里仍能读到同一组调用（打包后没有源码行号）：

```js
const automaticCheck = () => {
  if (!quitting) mandatoryPolicy?.check("foreground-or-resume")...
  if (!quitting) updateSchedule.check()...
}
powerMonitor.on("resume", automaticCheck)
app.on("will-quit", () => {
  updateSchedule.dispose()
  powerMonitor.off("resume", automaticCheck)
  updates.dispose()
})
```

同一参考文件约 1240 行还有 `powerMonitor.on('shutdown', ...)`，只把 `sessionEnding` 设为 true。

插件跑在子进程里。参考树 `apps/desktop/src/host-process.ts` 的 `child.send` 只发 `shutdown`、`update-tasks` 和 `quit-inspection`。`apps/desktop-host/src/index.ts` 的 `process.on('message')` 也只处理这三种。安装版 asar 里没有 `dsh/power`，也没有 `type: 'power'`。

页面可见性和迟到的定时器都不是系统唤醒。插件里的 `bindPowerMonitor` 只有在调用方注入 `powerMonitor`，或插件自己跑在 Electron 主进程时才会接到 `suspend` / `resume`。`bindHostPower` 会 `ctx.on('dsh/power', onPower)`，宿主没发事件时这是空订阅。

## 拟议宿主 diff

未应用。三处要一起改，否则事件到不了插件。on/off 必须是**同一个命名函数引用**。

### 1. `apps/desktop/src/host-process.ts`

在 `DesktopHostProcess` 上增加一个不带请求号的通知。现有 `control()` 都带 `requestId`，电源事件不需要回包。

```diff
   notifyPower(phase: 'suspend' | 'resume'): void {
     const child = this.child
     if (child?.connected) child.send({ type: 'power', phase })
   }
```

### 2. `apps/desktop/src/main.ts`

`host` 现在写在 `DesktopBackendController` 的回调里面，`automaticCheck` 够不着它。先在外层留一个引用，再把现有的 `resume` 监听替换成一个命名函数；`automaticCheck` 函数本身不改，只是由这个函数调用。不要保留原来的 `powerMonitor.on('resume', automaticCheck)` 再追加一个，否则一次唤醒会跑两遍。

```diff
   let hostProcess: DesktopHostProcess | undefined
```

构造 `DesktopHostProcess` 时赋值 `hostProcess = host`。先找到并删除现有的 `powerMonitor.on('resume', automaticCheck)` / `powerMonitor.off('resume', automaticCheck)`，再用下面的替换块：

```diff
   const onSuspend = (): void => {
     hostProcess?.notifyPower('suspend')
   }
   const onResume = (): void => {
     hostProcess?.notifyPower('resume')
+    automaticCheck()
   }
   powerMonitor.on('suspend', onSuspend)
-  powerMonitor.on('resume', automaticCheck)
+  powerMonitor.on('resume', onResume)
   app.on('will-quit', () => {
     updateSchedule.dispose()
     powerMonitor.off('suspend', onSuspend)
-    powerMonitor.off('resume', automaticCheck)
+    powerMonitor.off('resume', onResume)
     updates.dispose()
   })
```

`off('suspend', onSuspend)` / `off('resume', onResume)` 用的就是 `on` 时传入的那个函数。不要再包一层箭头，否则卸不掉。不要 `on(() => notifyPower(...))` 却 `off(notifyPower)`。如果当前版本的 `automaticCheck` 注册在本块之外，也必须删掉那一处，不能把本块追加成第二个 `resume` 监听。

### 3. `apps/desktop-host/src/index.ts`

在 `const { ctx } = await application` 之后才能 `emit`。启动完成前收到的电源消息丢掉，不排队。跨进程时序：主进程可能在 host 还没 `await application` 时就发出 `resume`；丢掉比错发到未就绪的 `ctx` 安全。

```diff
   declare module '@deepseek-ai/cordis' {
     interface Events {
       'dsh/power': (phase: 'suspend' | 'resume') => void
     }
   }
```

```diff
     if (message.type === 'power') {
       if (!('phase' in message) || (message.phase !== 'suspend' && message.phase !== 'resume')) return
       const running = await application.catch(() => undefined)
       running?.ctx.emit('dsh/power', message.phase)
       return
     }
```

这段要放在现有 `shutdown` 判断之后、`quit-inspection` 判断之前。

## 插件接线（已提交，等宿主事件）

`index.js` 的 `apply` 调用 `bindHostPower(ctx, service)`。`onPower` 是同一个函数：`suspend` 时 `service.pause()`，`resume` 时 `service.resume()`。卸载走 `ctx.on` 的返回值，没有返回值时用 `ctx.off('dsh/power', onPower)`。没有 `ctx.on` 时绑定是空操作。

这不是真机唤醒证据。宿主没发出 `dsh/power` 之前，CR-4 仍 OPEN。

## 验证

宿主 diff 未应用，所以 1–4 都还没跑。5 只证明插件能挂上同名函数。

1. 在参考树对这三处做类型检查，确认 `Events` 增补后 `ctx.emit('dsh/power', 'resume')` 能通过编译。安装版 0.2.2-rc.2 的对应位置要以当时源码再核一次，不能拿 0.2.0 行号当已应用。
2. 用现有 `apps/desktop/tests/host-process.spec.ts` 的假子进程，断言 `notifyPower('resume')` 发出 `{ type: 'power', phase: 'resume' }`，并且不带 `requestId`。
3. 给 desktop-host 加一个假消息测试：`power` 在 `application` 完成前被忽略；完成后 `ctx` 上的 `dsh/power` 监听收到 `resume`。再测 `off` 之后同一函数不再触发。
4. 真机、当前安装版 0.2.2-rc.2：合上笔记本再打开，看额度插件是否收到 `resume` 并补拉一次。页面切回前台不算这次验证。
5. 插件单测：`bindHostPower` 用同一 `onPower` 订阅和释放。这不是桌面唤醒。

## 回滚

撤掉上面三处宿主 diff，重新构建桌面壳和 desktop-host。插件订阅在没有事件时是空操作，可以留着。`powerMonitor.on('resume', automaticCheck)` 保持不动。

## 不在这次范围

- 不改 0.2.2-rc.2 的安装包，不重装 0.2.1。
- 不把 `automaticCheck` 的策略或更新行为交给插件。
- 不用页面可见性或定时器迟到冒充系统唤醒。
