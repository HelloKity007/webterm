# ADR: layout、presence 与终端渲染保持分层

日期：2026-09-13  
状态：Accepted（dev-1.0.5）

## 决策

- 布局继续使用 schema v2 全量 snapshot 与 revision CAS。divider 拖动只做本地 rAF 预览，释放后 fit，并在 500ms 防抖窗口内只保存一次；并发冲突返回稳定的 `LAYOUT_CONFLICT`，失败端重新获取权威布局，不做隐式合并。
- presence 是进程内短生命周期状态，不写 SQLite。身份键为 `userID + terminalID + sessionStorage clientID`；重复 socket 只算一个设备，断开后保留 15 秒重连宽限，并通过既有控制 WS 发送 typed snapshot/delta。
- 同一 terminalID 的输入默认由共享 tmux 会话同步，不增加广播开关，也不把在线设备数描述为人数或权限身份。
- 终端输出进入有界解析泵：每次最多向 xterm 提交 16KiB，等待 write callback 后再提交下一块，保持字节顺序并限制主线程单次工作量。WebGL context loss 时释放 addon 并回退 DOM renderer，不重建 terminal/tmux 身份。
- 9444 release-test 使用独立 tmux 3.7c 与 `webterm-release-test-fixed` socket；容量和清理脚本必须显式接受该 binary/socket，不能落到生产默认 socket。

## 原因与取舍

这组选择保留现有服务器权威模型和 tmux 会话语义，同时把高频视觉更新、低频持久化和瞬时在线状态分开。代价是并发布局不会自动合并，presence 在服务重启后重新建立；两者均比引入未设计的 CRDT 或持久化“在线”状态更可预测。

16KiB 输出预算不会丢数据，但高吞吐积压会延后显示。真实硬件加速 Chrome 的 8 pane × 64KiB/s 测试用于判定交互门槛；Xvfb 软件渲染数据只作为环境对照，不能替代用户可见浏览器结果。

## 必须持续回归

- 一次 divider drag 只产生一次布局 PUT；双客户端冲突为一个 200、一个 409，最终收敛。
- 两端刷新宽限、关闭后过期、跨用户隔离、同 terminalID 共享和不同 terminalID 不串扰。
- 8 pane 持续输出、100 次输入回显、30 分钟内存趋势、WebGL→DOM fallback、renderer 数与可见终端数一致。
- 3 客户端 × 8 shell 容量和测试 tmux 清理；生产 9443 未获当轮明确批准时不得部署。
