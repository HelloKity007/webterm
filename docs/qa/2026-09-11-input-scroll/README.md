# 桌面端输入与历史滚动验收 — 2026-09-11

测试地址：https://192.168.11.87:9444/ 。部署代码版本：`d65abb34e8275fc1e5de26472b4cd62f5e020087`。

结论：本轮桌面 Bash / Claude 输入、回车、长历史滚轮查看、滚回底部后继续输入 PASS；提交用户人工复检。不是移动端、双屏、所有隐藏标签或全产品的验收结论。

在主仓库 `dev-1.0.3` 实施，无 worktree。临时免登录仍仅在 release-test 启用。生产 9443 未发布。

## 修复内容与实际原因

- control-mode 输入原先把原始回车、换行直接放进 tmux 命令引号内；改用 `send-keys -H` 传递精确字节，并移除外层 SSH PTY 的行规程转换。pane tracker 添加并发保护。
- 浏览器此前是 73×19，而 tmux 是 80×24，导致全屏 CLI 的坐标重绘覆盖。恢复快照现在先宣布远端网格，并恢复 alternate screen、逐行位置、光标。浏览器按准确网格渲染，不做画布拉伸。
- shell 重连回放包含 tmux 历史（最多 20,000 行），避免刷新仅剩当前屏幕。新输出不改写控制字符。
- 调试时对 pane ID 中制表符的怀疑未被证实：Go 字符串会转义成真制表符；不将它列为根因。

## 真实浏览器操作

opencli 会话 `webterm-direct`，实际 Chrome，桌面 viewport 2808×988，工作区 1:3572，8 个可见面板。

opencli 1.8.4 默认 `keys Enter` 产生 trusted keydown，但 `keyCode=0`、`code=""`；这不能验证 xterm 的正常键盘行为。通过同一 opencli Page 的 CDP 输入接口补齐 `windowsVirtualKeyCode`、`code`，执行真实浏览器按键、Input.insertText 和 Input.dispatchMouseEvent(mouseWheel)。未使用 DOM 合成 WheelEvent 或 headless 浏览器替代。

复现脚本位于本机 `/tmp/webterm-sdlc-evidence/2026-09-11-direct/browser-input.mjs`。browser-use 未在本次运行，不能声称已完成旧交接要求的双工具完整验收。

## 验收结果

| 场景 | 结果 | 证据 |
| --- | --- | --- |
| Bash panel 1 输入中英文命令并回车，生成 500 行 | PASS | `acceptance-final.png`；BASH_QA_0001–0500 |
| Bash 上滚至少20次、下滚并继续执行命令 | PASS | BASH_RESUMED_OK、FINAL_BASH_KEYBOARD_OK 实际输出 |
| 刷新后 500 行仍全部存在 | PASS | `bash-buffer.json`：500 个编号、missingBash=[]、1160 行缓冲 |
| 左下可见面板的 Bash 再生成300行、上滚20次、下滚20次、继续输入 | PASS | `bash-second-history.png`、SECOND_BASH_RESUMED_OK。该位置活动标签是 **12:x99**；测试标记 BASH_PANEL5 指屏幕位置5，不是标签5 |
| Claude panel 6 输入中文请求并回车，输出150行 | PASS | CLAUDE_QA_DONE，`claude-first-number.png` |
| Claude 滚回底部继续输入，第二次输出60行 | PASS | CLAUDE_INPUT_RESUMED_OK，`claude-return-bottom.png` |
| Claude 35次上滚逐页核对150+60行 | PASS | `claude-history-scan-final.json`：两组缺号均=[]；firstCount=151包含被截断前缀匹配到的0，有效范围1–150均存在 |
| Claude 45次下滚回底部后第三次请求 | PASS | `acceptance-final.png`：FINAL_KEYBOARD_OK |
| 可见8面板网格、行距、Claude输入区 | PASS（此桌面尺寸） | `acceptance-final.png`、`final-claude-mid.png`：80×24，lineHeight=1，无之前的阶梯错行/重绘覆盖 |

滚轮期间 rAF 帧间隔采样：Bash P95约16.8ms、最大16.8ms；Claude 45次下滚 P95约16.7ms、最大66.8ms。支持本次桌面运行没有持续卡顿，不代表所有设备性能承诺。

控制台最终采集0条消息，见 `final-console.json`。

## 自动检查

最终部署运行：UI 74/74、eslint、TypeScript/Vite build、go test ./... 全部通过；后续 go test -race ./handler 通过。Vite仍有已有的bundle大小提示。

新测试覆盖按键字节保真、CR/LF/ESC/中文编码、快照屏幕/光标恢复与shell历史保留。测试环境健康检查返回release-test和上述版本。

## 人工复检与仍未覆盖的范围

刷新9444页面后可直接进入。请复检Bash和Claude的文字、Enter、上/下滚、底部继续输入。

本轮未重新完成移动端、双屏、复制粘贴全矩阵及隐藏标签逐一测试；Ctrl+Home/Ctrl+End不计入本轮PASS，滚轮返回底部已单独验证。旧交接这些项目不能由本轮结果自动转为PASS。
