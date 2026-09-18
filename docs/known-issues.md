# 已知问题记录

## 2026-09-04 Claude fullscreen 长会话滚轮重绘卡顿（上游回归，有本地缓解）

- **现象**：Claude fullscreen 的短会话滚动正常；长会话连续向上滚动到一定位置后可能长时间无响应，改变滚动方向后又能继续。
- **现场排除**：对应 WebTerm session 未进入 tmux copy-mode；pane 为 `alternate_on=1`、`mouse_any_flag=1`，tmux `history_size=0`，说明历史与滚动均由 Claude retained-history renderer 管理。
- **上游依据**：`anthropics/claude-code#80033` 已把 fullscreen 滚动抖动定位为 2.1.215 → 2.1.216 回归；`#84712` 记录长会话持续整屏 repaint 后单次滚轮可延迟 1–3 秒。当前现场版本为 Claude Code 2.1.246，仍落在受影响范围。
- **WebTerm 缓解**：不改变普通滚轮，以免影响短会话和触控板手感；`Shift+滚轮` 在 alternate-screen 中改为最多每 120ms 一次的 `PageUp/PageDown`，绕开 Claude 逐行 mouse repaint。main-screen 中仍走原 tmux history 路径。
- **保留限制**：WebTerm 无法修复 Claude 内部 renderer；若普通滚轮仍在极长会话中卡顿，应使用 `Shift+滚轮`、物理 `PgUp/PgDn` 或 Claude transcript。上游修复后需复测再决定是否移除缓解。

## 2026-08-13 ZMODEM `rz` 上传卡住（待排查）

### 2026-09-18 实机补充（测试候选 diagnostic11）

### 2026-09-18 diagnostic13 已关闭下载缺陷；上传仍不支持

- 隔离真实 SSH、私有 tmux、浏览器终端的 `sz -b` 64 KiB 下载已通过：浏览器
  下载文件 SHA-256 为 `7daca209…b27e4c2`，传输结束后的 shell 标志及下一条
  命令均可见。证据：`runtime/zmodem-browser-diagnostic13/report.json`。
- lrzsz 在这条路径的 ZFIN 后没有发送 zmodem.js 等待的可选 `OO` 字节，曾使
  已完成传输后的首段 shell 输出被错误留在协议层。现仅对该库的精确 post-ZFIN
  错误恢复终端；校验、协议或传输错误不会被当成成功。
- `rz` 上传仍是**明确禁用**：已验证提示、abort 和 shell 恢复，不是上传功能
  验收。保留本节直到真实浏览器上传、取消、重连、文件 SHA 和恢复全部完成。

- 在隔离的真实 SSH、私有 tmux 和浏览器终端中，`sz -b` 下载 64 KiB
  测试文件未产生浏览器下载事件，30 秒超时。当前不能再把此下载路径描述为
  “已可用”；证据保留于 `runtime/zmodem-browser-run2/`。
- 原始 SSH 握手包含 ZDLE。另一次浏览器 `rz` 握手的 WebSocket 数据也保留
  ZDLE，并触发了上传禁用提示和 abort；因此尚无证据认定 tmux 普遍吞掉
  协议控制字节。下载故障原因与取消后的终端恢复仍在进一步验证。
- `rz` 上传继续禁用。原始 SSH 握手诊断不等于产品端到端传输通过；
  必须取得浏览器实际收发文件及哈希证据后才能关闭该项。
- 下载原因已进一步定位：当前 `ZTransfer` 将 `accept()` 错误声明为
  `Promise<void>`，随后调用依赖并不存在的 `get_payloads()`。安装的
  `zmodem.js/src/zsession.js` 中 `Offer.accept()` 实际返回收到的数据数组；
  此异常被下载路径空 catch 吞掉。真实测试已捕获传输结束但没有浏览器下载，
  最小接口修复与回归正在进行，尚未部署或验收通过。
- 独立 `rz` 验证已确认禁用提示、abort 和后续 shell 命令正常执行
  （`runtime/zmodem-browser-rz-confirm/report.json`）；这是安全拒绝能力通过，
  不是上传功能通过。

> 1.0.6 候选的临时处置：检测到 `rz` 后立即中止并提示使用 SFTP，避免
> 会话进入无进度的挂起状态。完成真实 SSH + lrzsz 双向传输与内容 hash
> 门禁前，不重新开放浏览器 ZMODEM 上传。

- **现象**：远端执行 `rz` 后终端提示“按 Enter 选择要上传的文件”，按 Enter 能正常打开系统文件选择框；但**选择文件之后上传卡住**，没有进度、没有完成，会话挂起。
- **已确认正常**：ZMODEM 握手能检测并进入会话；`sz` 下载已按上述 diagnostic13
  实测通过。`rz` 不再打开选择文件流程，而是立即明确拒绝并返回 shell。
- **排查线索**：
  1. 选文件后走 `Zmodem.Browser.send_files(session, files)`，卡住位置待定位 —— 先确认 send_files 是否发出 ZRINIT/ZFILE/ZDATA，远端 `rz` 是否收到。
  2. 二进制上行通道：文件数据经 base64 JSON（`{b64:true}`）发给服务端，服务端解码后写入 PTY —— 检查大帧是否被 PTY/驱动截断或乱序，建议在 `wsWriter`、HandleSSH 的 stdin 写入、前端 sender 三处加日志。
  3. 之前重复 ZRQINIT 会让 consume 抛 “Unhandled header: ZRINIT”，已改为吞掉；需确认吞掉异常后会话状态是否仍然可用。
  4. 浏览器端 zmodem.js 的 `sender` 回调是否持续触发、分帧大小是否异常。
- **待办**：用真实 SSH + lrzsz 端到端复现，逐步加日志定位卡在哪一段（前端 send_files → WebSocket → 服务端解码 → PTY → rz）。
