# ADR: tmux namespace 与 history-limit

日期：2026-09-11  
状态：dev-1.0.4 已采用

## 决策

- 生产环境暂时继续使用目标账号的默认 tmux socket，以无损续接 `2df868a` 已存在的会话。
- 测试环境继续使用 `tmux -L webterm-release-test`，禁止测试连接改变生产会话的尺寸、历史或生命周期。
- 每次创建/attach WebTerm 会话前先通过缓存的 `tmux -V` 预检，最低支持版本为 3.1。
- 暂不把现有生产会话自动迁移到专用 socket。未来若迁移，必须提供显式迁移/回滚方案并重新取得生产发布批准。

## 已知副作用

当前生成的启动命令保留 `set-option -g history-limit 200000`。在默认 socket 中，这是该 tmux server 的全局默认值，会影响之后新建 pane 的历史容量；它不会把浏览器输入转发到其他 terminalID，也不会由测试环境写入生产 tmux server。保留它是为了不回退已经验收的长历史能力。

## 后续门禁

- 专用生产 namespace 的迁移必须证明旧 session 不会静默丢失。
- 测试环境必须继续使用独立 socket。
- 普通 WebSocket 断开、网络故障和服务部署只 detach；只有显式关闭 terminal tab 才 kill session。
