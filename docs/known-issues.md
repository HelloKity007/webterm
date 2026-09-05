# 已知问题记录

## 2026-09-04 Claude fullscreen 长会话滚轮重绘卡顿（上游回归，有本地缓解）

- **现象**：Claude fullscreen 的短会话滚动正常；长会话连续向上滚动到一定位置后可能长时间无响应，改变滚动方向后又能继续。
- **现场排除**：对应 WebTerm session 未进入 tmux copy-mode；pane 为 `alternate_on=1`、`mouse_any_flag=1`，tmux `history_size=0`，说明历史与滚动均由 Claude retained-history renderer 管理。
- **上游依据**：`anthropics/claude-code#80033` 已把 fullscreen 滚动抖动定位为 2.1.215 → 2.1.216 回归；`#84712` 记录长会话持续整屏 repaint 后单次滚轮可延迟 1–3 秒。当前现场版本为 Claude Code 2.1.246，仍落在受影响范围。
- **WebTerm 缓解**：不改变普通滚轮，以免影响短会话和触控板手感；`Shift+滚轮` 在 alternate-screen 中改为最多每 120ms 一次的 `PageUp/PageDown`，绕开 Claude 逐行 mouse repaint。main-screen 中仍走原 tmux history 路径。
- **保留限制**：WebTerm 无法修复 Claude 内部 renderer；若普通滚轮仍在极长会话中卡顿，应使用 `Shift+滚轮`、物理 `PgUp/PgDn` 或 Claude transcript。上游修复后需复测再决定是否移除缓解。

## 2026-08-13 ZMODEM `rz` 上传卡住（待排查）

- **现象**：远端执行 `rz` 后终端提示“按 Enter 选择要上传的文件”，按 Enter 能正常打开系统文件选择框；但**选择文件之后上传卡住**，没有进度、没有完成，会话挂起。
- **已确认正常**：ZMODEM 握手能检测并进入会话；按 Enter 弹文件选择框（用户手势）有效；`sz` 下载流程尚未端到端验证（待测）。
- **排查线索**：
  1. 选文件后走 `Zmodem.Browser.send_files(session, files)`，卡住位置待定位 —— 先确认 send_files 是否发出 ZRINIT/ZFILE/ZDATA，远端 `rz` 是否收到。
  2. 二进制上行通道：文件数据经 base64 JSON（`{b64:true}`）发给服务端，服务端解码后写入 PTY —— 检查大帧是否被 PTY/驱动截断或乱序，建议在 `wsWriter`、HandleSSH 的 stdin 写入、前端 sender 三处加日志。
  3. 之前重复 ZRQINIT 会让 consume 抛 “Unhandled header: ZRINIT”，已改为吞掉；需确认吞掉异常后会话状态是否仍然可用。
  4. 浏览器端 zmodem.js 的 `sender` 回调是否持续触发、分帧大小是否异常。
- **待办**：用真实 SSH + lrzsz 端到端复现，逐步加日志定位卡在哪一段（前端 send_files → WebSocket → 服务端解码 → PTY → rz）。
