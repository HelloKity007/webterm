# WebTerm Control Mode 交接文档（新会话必读）

## 交接结论

上一会话错误地把协议层和 headless Chromium 结果当成了用户验收结果。当前版本不得宣称视觉和交互通过，也不得直接发布生产环境。

上一会话实际使用的是本地 Playwright/Chromium、HTTP/WebSocket 和 tmux 检查；没有通过用户指定的 `opencli` 和 `browser-use` 完成真实登录后的视觉检查。这是本交接的首要纠正项。

## 当前代码与环境

- 工作目录：`/media/pgz/DATA-B/code/tools/webterm-xufanchn/webterm-HelloKity007`
- 当前分支：`dev-1.0.3`
- 当前 HEAD：`14a409d`
- 测试环境：`https://192.168.11.87:9444/`
- 最近一次已部署测试版本：`37df99b6a635c924e768024b832f16b6b2dace37`
- 生产环境：`https://192.168.11.87:9443/`，本阶段禁止自动修改
- 测试账号：`admin / admin`
- 目标真实浏览器会话：`opencli 28hn9a74`

## 已有实现（仅视为候选，不视为验收通过）

1. xterm WebGL renderer，失败时回退。
2. WS 输出按 animation frame 合并。
3. Control Mode `tmux -C` 传输。
4. 既有 pane 连接后的 `capture-pane` 首屏回放。
5. pane ID 和 `pane_current_command` 预取，识别 Bash/Claude。
6. Control Mode 输入通过 tmux `send-keys`，resize 通过 `refresh-client -C`。
7. Claude wheel 路径尝试转换 PageUp/PageDown。
8. 20,000 行 xterm scrollback、服务端有界历史缓存和历史回放接口。

## 必须重新验证的用户场景

使用 `opencli 28hn9a74` 进入真实浏览器，并在浏览器中登录测试环境。必须观察截图、布局、字体、滚动条、输入框和实际交互，不得只读 WS 帧。

### 桌面端

- 检查所有 panel 的尺寸、字体、换行、输入框位置。
- 真实 Claude panel 6：鼠标向上滚动至少 20 次，确认历史连续、不卡顿、不丢顶部内容；再向下滚动恢复输入区。
- 使用 PageUp/PageDown、Ctrl+Home/Ctrl+End。
- 输入中文、英文、符号，确认不是转义字符。
- Bash panel 1/5：鼠标滚轮只能查看输出缓存，不得变成 readline 命令 history。
- 选中复制、粘贴、Ctrl+C、右键菜单。

### 移动端

- 只打开移动端时检查字体、比例、panel 是否一屏一个、Claude 输入框是否在底部。
- 手指滑动 Claude 历史，确认实际滚动而不是无响应或输入命令。
- Bash 手指滑动查看输出缓存，不得触发上下键命令历史。
- 同时打开 3440×1440 大屏和移动端同一 workspace/panel，确认不出现字体重叠、内容截断、输入框漂移或大片空白。
- 反复切换 tab/panel，确认 websocket、SSH channel、tmux 会话不重复泄漏。

## 验收证据要求

每个场景必须保存 `opencli`/`browser-use` 操作步骤、截图或 DOM 证据、panel 名称与分辨率，以及失败时的 console、WS 和服务端日志。结论只能写 PASS / FAIL / BLOCKED，不能用“协议帧正常”替代视觉 PASS。

## 代码检查门槛

```bash
npm --prefix ui test -- --run
npm --prefix ui run lint
npm --prefix ui run build
go test ./...
curl -sk https://192.168.11.87:9444/api/health
```

只有真实浏览器全部 PASS 后，才允许提交最终修复、重新部署测试环境；生产环境 9443 必须由用户明确批准后再发布。

## 当前已知风险

- Control Mode 默认启用后的真实 Claude alternate-screen 视觉效果尚未被 `opencli/browser-use` 验证。
- headless Playwright 的 DOM wheel/TouchEvent 不能代表真实鼠标和手机惯性滑动。
- 既有 Claude 会话的历史可能来自 alternate-screen，不能只凭 `capture-pane` 宣称完整回放。
- 当前分支最后一个测试提交未必已经部署；以 `/api/health` 返回的 version 为准。
- 不要 reset、删除或清理用户现有 tmux 会话；不要未经用户批准部署 9443。

## 新会话第一步

先读取本文件和 `docs/exec-plans/active/2026-09-10-webterm-control-mode-upgrade.md`，然后使用 `opencli 28hn9a74` / `browser-use` 实际登录测试环境，先记录 FAIL 现象，再修复。不要先根据旧结论回复“已完成”。
