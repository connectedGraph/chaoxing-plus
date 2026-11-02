# 学习通自动刷课脚本 V3 稳定版

一个基于 Tampermonkey/Greasemonkey 的用户脚本,用于在超星学习通(`*.chaoxing.com`)的课程学习页自动播放视频、自动推进章节、并提供一个可视化的课程目录控制面板。

> 版本:`3.3.0` · 入口文件:[`user-2.js`](./user-2.js) · 运行时机:`document-idle`

**推荐安装 `user-2.js`(3.3.0,DOM 校验版)。** 它用 DOM 判定任务点是否已完成,已完成直接跳过,不靠 `play()` 超时去猜;`user.js`(3.2.0)是更早的稳定版,留作对照。

## 文件说明

| 文件 | 说明 |
| --- | --- |
| `user-2.js` | **3.3.0 DOM 校验版,推荐** |
| `user.js` | 3.2.0 稳定版 |
| `probe.user.js` | 调试用探测脚本,包装 `play()` 记录触发链,日常请禁用 |
| `auto-answer.user.js.archive` | V4 自动做题(截图发 AI 取答案并提交),已归档,未维护 |

---

## 适用范围

脚本通过 `@match` 注入到以下页面:

- `*://mooc1.chaoxing.com/mycourse/studentstudy*`
- `*://*.chaoxing.com/mycourse/studentstudy*`
- `*://*.chaoxing.com/mooc2-ans/mycourse/studentstudy*`

如果页面没有内置 jQuery,脚本会自行从 CDN 加载 `jquery-3.6.0.min.js` 后再启动。

---

## 安装

1. 在浏览器安装 [Tampermonkey](https://www.tampermonkey.net/) 或 Violentmonkey。
2. 新建脚本,将 [`user.js`](./user.js) 全部内容粘贴并保存。
3. 进入任一课程的 `studentstudy` 学习页,脚本自动启动并在右上角弹出控制面板。

---

## 核心特性

### 自动播放器(`window.app`)

- **多层 iframe 视频探测** —— `_findVideoContext()` 递归遍历两层 iframe,锁定 `video#video_html5_api`,兼容学习通常见的嵌套播放器结构。
- **倍速播放** —— 默认 `1.5x`,通过 `app.configs.playbackRate` 调整,绑定/重绑都会重新写入 `playbackRate`。
- **自动播放策略链** —— `_kickPlay()` 先 `play()`,失败回落到 *静音 play*,再失败则 `_simulateClickToPlay()` 模拟点击 `.vjs-big-play-button` / `.vjs-poster` / `video` 本体,最大化绕开浏览器自动播放策略。
- **真实鼠标事件模拟** —— `_fireClick()` 用准确的 `clientX/clientY` 依次派发 `mousedown` → `mouseup` → `click`,优于裸调 `el.click()`。
- **video 元素重绑环** —— `_startRebindLoop()` 每 `3s` 巡检一次,学习通切换小节后替换的新 `<video>` 会被自动重新挂载事件监听。
- **结束态双重判定** —— 既听原生 `ended` 事件,也用 `_isVideoEnded()` 兜底:当 `duration - currentTime ≤ 0.5s` 持续 `4s`,即认定为结束(防止 `ended` 不触发的脏视频)。
- **进度保活看门狗** —— `_checkVideoStatus()` 每秒检查一次,若 `currentTime` `7s` 内无推进,触发 `_tryResumePlayback('no-progress')`,带 `1.5s` 冷却避免死循环。
- **暂停自愈** —— 视频被外力暂停且不在结束态时,自动恢复播放。
- **页面失焦/切后台不停播** —— 监听 `mouseleave` / `mouseout` / `blur` / `visibilitychange`,既阻止学习通的"鼠标离开页面暂停"行为,又在页面切回时主动唤醒播放。
- **任务点完成后自动推进** —— 同章节内还有视频则点击下一个 `posCatalog_select`,否则跳到下一章。整门课结束时打印 *"本课程学习完成了"* 并清理所有定时器。
- **章节测验自动跳过** —— 当 `play()` 等不到视频元素时:
  - 若当前不在"视频"页签,自动点击 `2 视频` 切换;
  - 若已是测验页,触发 `#prevNextFocusNext`(下一步)继续推进;
  - 仍失败则按 `retryInterval (2s)` 重试,直到 `maxRetries (10)` 上限。
- **步骤导航重接管** —— 监听 `.prev_white` 上的点击,凡含"视频"两字即重置内部状态并重新接管,避免用户手动切页签后失控。
- **弹窗清理扫描器** —— `_startPopupScan()` 每秒扫描 `document` 与所有 iframe 内的 `.popDiv`(任务点未完成提示)、`.mask` / `.maskDiv` / `.ui-mask`,按钮存在则点击 `.popClose`,否则强制 `display:none`。

### 课程目录控制面板(`window.coursePanel`)

一个右上角浮动面板,完全由脚本注入,与原页面 DOM 联动。

- **章节解析** —— `parseChapters()` 解析 `#coursetree` 的两层结构,识别章/节标题、`id`、`jobUnfinishCount`、`orangeNew`、`catalog_points_yi` 等字段,推算 *未完成数* 与 *是否完成*。
- **进度统计** —— 头部实时显示 `已完成 X/Y`。
- **三态视觉**:
  - 🟢 未完成 —— 灰底 ▶ 图标 + 红色未完成数徽章
  - ⚪ 已完成 —— 删除线 + 灰色 ✓
  - 💙 当前播放 —— 蓝色高亮 + 📍 + "当前"徽章
- **章节折叠** —— 点击章标题切换该章下所有节的显隐。
- **筛选未完成** —— `🔍 未完成` 按钮一键隐藏已完成项,空章节自动隐藏。
- **定位当前** —— `📍 定位` 按钮平滑滚动到当前播放节,并附带 `boxShadow` 高亮闪烁 `1.5s`。
- **重新解析** —— `🔄` 按钮调用 `refresh()` 重新读取 DOM,适用于课程结构变动后。
- **一键开关自动播放** —— `▶ 自动` / `⏸ 停止` 按钮直连 `window.app.run()` / `window.app.stop()`,每 `1.5s` 同步一次按钮状态。
- **跳过练习测试 开关** —— 复选框 `有练习测试需跳过(右边课程数为 2)`:勾选后视频结束改为点 `#prevNextFocusNext`(进入同小节下一个任务点),用 `localStorage` 持久化(键:`chaoxing.skipExerciseTestByStepAdvance`)。
- **面板 ⇄ 页面双向同步**:
  - 在面板点节,触发原页面 `posCatalog_name` 的真实 `click()`,同时把 `app._cellData` 重置并重新 `play()`。
  - 反过来,`app._startPanelSync()` 每 `1.5s` 读取页面 `.posCatalog_active`,如有变更调用 `coursePanel.setActive(id, { scroll: true })`。
- **拖拽** —— 头部按住可拖动到任意位置,按钮区域不触发拖拽。
- **折叠/关闭** —— `−` 折叠 body,`✕` 移除整个面板。

### 健壮性

- **保活冷却 / 重试上限**(`guardResumeCooldownMs`、`maxRetries`)避免风暴式调用。
- **异常隔离** —— 关键路径(iframe 跨域、DOM 缺失等)全部 `try/catch`,单点错误不会让整个脚本崩溃。
- **彩色日志** —— 控制台用 `%c` 着色分类输出(▶ 绿色播放、🔄 紫色重绑、⚠ 橙色重试、❌ 红色错误),方便排查。

---

## 关键配置

集中在 `window.app.configs`,可在控制台运行时改写:

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `playbackRate` | `1.5` | 视频倍速 |
| `autoplay` | `true` | 切节后是否自动开播 |
| `retryInterval` | `2000` | `play()` 失败重试间隔(ms) |
| `maxRetries` | `10` | `play()` 最大重试次数 |
| `videoCheckInterval` | `1000` | 视频状态轮询周期(ms) |
| `guardNoProgressMs` | `7000` | 进度停滞多久判定卡死 |
| `guardResumeCooldownMs` | `1500` | 保活恢复冷却,防抖 |
| `videoLoadTimeoutMs` | `15000` | 等待视频元素总超时 |
| `videoLoadPollMs` | `500` | 等待视频元素轮询 |
| `rebindIntervalMs` | `3000` | video 元素重绑周期 |
| `endedNearDurationDelta` | `0.5` | 接近结束的剩余秒阈值 |
| `endedStallMs` | `4000` | 接近结束停滞多久判定结束 |
| `popupScanIntervalMs` | `1000` | 弹窗扫描周期 |
| `panelSyncIntervalMs` | `1500` | 面板 ⇄ 页面同步周期 |
| `clickToPlayRetryMs` | `1500` | 模拟点击后重试的延迟 |
| `skipExerciseTestByStepAdvance` | `false` | 视频结束后是否走"下一步"而非"下一节" |

---

## 控制台 API

```js
window.app.run();      // 启动
window.app.stop();     // 停止(清掉所有 interval)
window.app.play();     // 立刻播当前视频
window.app.nextUnit(); // 强制切下一节

window.coursePanel.refresh();           // 重新解析目录
window.coursePanel.scrollToActive();    // 滚到当前节
window.coursePanel.setActive(id, { scroll: true });
```

---

## 已知行为说明

- 脚本 **不会自动答题**,只会跳过章节测验页继续播放视频。
- 跨域 iframe(非超星自身域)会被 `try/catch` 静默忽略,可能导致极少数嵌入式播放器探测不到 video。
- jQuery 仅在页面未提供时才加载;若网络受限,启动会延迟到 CDN 拉取完成。

---

## Roadmap

未来计划加入的能力:

### 1. 静音 / 倍速可自定义开启

把现在硬编码的 `playbackRate: 1.5` 与"静音回落"行为开放为面板上的开关与输入框:

- 倍速选择(`1x / 1.25x / 1.5x / 2x` 或自定义数值)。
- 是否允许自动静音(部分用户希望保留声音、宁可手动点一次播放)。
- 选择持久化到 `localStorage`,与 `skipExerciseTestByStepAdvance` 同一套读写工具。

### 2. 启动后自动跳到首个未看的课程

脚本注入后扫描 `coursePanel.parseChapters()` 的输出,选出第一个 `isCompleted === false` 的小节,自动 `setActive` 并触发 `posCatalog_name.click()`,免去用户手动点开未看节这一步。

实现要点:

- 区分"完全未看"与"未完成的当前节",优先选择当前节,其次第一个未完成节。
- 提供面板开关,允许用户关闭该行为(避免覆盖手动选择)。

### 3. 页面 Bug 终止并触发浏览器/Windows 通知

当出现下列情形之一,脚本判定为不可恢复的页面 bug,**停止所有定时器**并通过 [Notification API](https://developer.mozilla.org/docs/Web/API/Notification) 弹出系统级通知(Windows 11 会进入操作中心):

- 多次尝试(`maxRetries` 用尽)后仍无 video 元素显示。
- 进度看门狗连续多轮检测到 `currentTime` 不推进且 `_kickPlay` 全部失败。
- `_findVideoContext()` 持续返回 `null` 超过 `videoLoadTimeoutMs * 2`。

实现要点:

- 启动时调用 `Notification.requestPermission()`,失败则降级为面板内红色横幅。
- 通知点击回调聚焦学习通标签页,方便用户立刻查看。
- 终止行为复用 `app.stop()` + `_clearAllIntervals()`,并把面板按钮切到 `⚠ 已停止` 态。

---

## 免责声明

本脚本仅作个人学习与技术研究用途,使用者应自行遵守所在学校与平台的相关规定。脚本作者不对因使用本脚本造成的任何后果负责。

---

## 附录 A. 触发链探测脚本 `probe.user.js`

为了搞清楚"视频究竟是被哪一层逻辑摇起来的"——是 `app.run()` → `play()` → `el.play()` 这条主链,还是 `_kickPlay()` 的静音回落,亦或 `_simulateClickToPlay()` 的模拟点击,又或仅仅是 `_handleVideoLoaded()` 里那一发 `setTimeout(_kickPlay, 200)`——仓库里附带了一个独立的探测脚本 [`probe.user.js`](./probe.user.js)。

### 它做了什么

- **`@run-at document-start`**,优先于 `user.js` 注入,这样才能在 `window.app` 被赋值前抢先打补丁。
- **包装 `HTMLMediaElement.prototype.play`**:每一次 `play()` 调用都被记录,带上 `currentTime` / `muted` / `paused` 与一段调用栈,Promise 解析/拒绝也单独记一行(直接看到浏览器自动播放策略拦截的瞬间)。
- **巡检所有 iframe**(每 `500ms` 一次),给嵌套窗口的 `HTMLMediaElement.prototype` 也打上同样的补丁——学习通的视频常常深埋两层 iframe。
- **捕获阶段监听 `play` / `playing` / `pause` / `loadedmetadata` / `ended` / `stalled`**,用 `playing` 作为"视频真的动了"的标志位,与上游的 `play()` 调用配对。
- **拦截 `window.app` 的关键方法**:`run` / `play` / `_kickPlay` / `_simulateClickToPlay` / `_fireClick` / `_tryResumePlayback` / `_handlePlayError` / `_handleVideoLoaded` / `_handleVideoPlay` / `_videoEventHandle` 等。利用 `Object.defineProperty(window, 'app', ...)` 的 setter,在 `user.js` 把 `app` 赋值给 `window` 的瞬间就把所有方法包一层。
- **统一时间轴**,所有事件按 `performance.now()` 与递增 `idx` 记录到 `window.__probe.events`,带颜色分类的控制台输出。

### 安装

像 `user.js` 一样新建一个 Tampermonkey 脚本,粘入 [`probe.user.js`](./probe.user.js) 全部内容并保存。Tampermonkey 默认按脚本的 `@run-at` 与添加顺序加载,本脚本的 `document-start` 一定早于 `user.js` 的 `document-idle`。

### 用法

打开任一 `studentstudy` 学习页,等视频开始播放后,在控制台敲:

```js
__probe.summary();      // 找到第一次 playing 事件，并回溯触发链
__probe.playCalls();    // 列出迄今所有 play() 调用 + 各自调用栈首行
__probe.events;         // 原始事件数组
__probe.clear();        // 清空，重新观察一段
```

`summary()` 的输出会形如:

```
[probe] 首次 playing @ 3421.3ms ←  触发链(从早到晚)
#12 +1820ms [wrap ] app.run()
#15 +1822ms [wrap ] app.play()
#21 +2010ms [media] loadedmetadata on <video#video_html5_api> ...
#22 +2010ms [wrap ] app._handleVideoLoaded()
#23 +2210ms [wrap ] app._kickPlay(<video#video_html5_api>)
#24 +2210ms [play ] play() on <video#video_html5_api> ct=0.00 muted=false paused=true
#25 +2440ms [warn ] play() rejected: NotAllowedError ...
#26 +2441ms [wrap ] app._simulateClickToPlay()
#27 +2442ms [wrap ] app._fireClick(<div#...>)
#28 +2510ms [play ] play() on <video#video_html5_api> ct=0.00 muted=true ...
#29 +3420ms [media] playing on <video#video_html5_api> ct=0.00 ...
--- 直接调用 play() 的栈 ---
    at HTMLMediaElement.play (probe.user.js:...)
    at app._kickPlay (user.js:237:...)
    ...
```

借此可以直接读出:**真正让视频动起来的是哪一次 `play()`,该次 `play()` 的调用方是 `app` 的哪个方法,前面是否有失败回落**——这正是 README 主体里那条"`play()` → 静音回落 → 模拟点击"策略链是否真的被走完的实证。

### 与 Roadmap 的关系

Roadmap 第 3 项(*页面 Bug 终止并触发通知*)的判定阈值——比如"重试多少次仍无 video"、"`currentTime` 卡住多久才算 bug"——可以直接基于 `__probe.events` 的真实分布来标定,而不是凭感觉拍脑袋。第 1 项(*静音/倍速可定制*)如果上线,也可以用同一探测脚本确认开关变更后是否真的不再走静音回落。

### 注意

- 探测脚本只读不改业务逻辑,但对 `play()` 的包装会在 `then/catch` 里追加日志,`await el.play()` 的等待时序保持等价。
- 跨域 iframe 仍然会被同源策略挡住,这一部分日志缺失属正常。
- 仅作调试用途,日常刷课时建议禁用以减小开销。
