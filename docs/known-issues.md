# 已知问题记录

## 2026-09-04 Claude fullscreen 长会话滚轮重绘卡顿（上游回归，有本地缓解）

- **现象**：Claude fullscreen 的短会话滚动正常；长会话连续向上滚动到一定位置后可能长时间无响应，改变滚动方向后又能继续。
- **现场排除**：对应 WebTerm session 未进入 tmux copy-mode；pane 为 `alternate_on=1`、`mouse_any_flag=1`，tmux `history_size=0`，说明历史与滚动均由 Claude retained-history renderer 管理。
- **上游依据**：`anthropics/claude-code#80033` 已把 fullscreen 滚动抖动定位为 2.1.215 → 2.1.216 回归；`#84712` 记录长会话持续整屏 repaint 后单次滚轮可延迟 1–3 秒。当前现场版本为 Claude Code 2.1.246，仍落在受影响范围。
- **WebTerm 缓解**：不改变普通滚轮，以免影响短会话和触控板手感；`Shift+滚轮` 在 alternate-screen 中改为最多每 120ms 一次的 `PageUp/PageDown`，绕开 Claude 逐行 mouse repaint。main-screen 中仍走原 tmux history 路径。
- **保留限制**：WebTerm 无法修复 Claude 内部 renderer；若普通滚轮仍在极长会话中卡顿，应使用 `Shift+滚轮`、物理 `PgUp/PgDn` 或 Claude transcript。上游修复后需复测再决定是否移除缓解。

## 2026-09-20 ZMODEM 已移除（非缺陷）

终端内 `sz`/`rz` 曾是历史兼容功能。它与 tmux、全屏 CLI 共用 PTY 字节流，
而 WebTerm 已提供具有上传、下载、取消、重试和完整性保障的 SFTP 文件管理器。
因此 ZMODEM 运行时代码、依赖和验收脚本已移除；这不是待修复项。
