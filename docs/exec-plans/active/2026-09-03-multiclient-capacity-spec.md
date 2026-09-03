# SPEC — 多端布局同步与 10×10×10 容量验收

- Tier: 3（并发、会话资源与真实浏览器交互）。
- Spec approval: not obtained (autonomous run)。用户已明确要求执行压测、优化并保证功能正常；本文件作为事后可审阅的实施约束。
- Setup plan:
  - Tools to install: none；复用仓库已有 Go、Vitest、Playwright 与系统 Chrome。
  - Git: 不创建提交；工作区已有用户未提交改动，验收仅针对本次涉及的文件。
  - Files the gauntlet will add: `handler/layout_hub.go`、`handler/layout_hub_test.go`、`sshmgr/pool_test.go`、`ui/src/components/layout/layoutSync.test.tsx`、`ui/tests/multiclient-capacity.spec.ts`、`scripts/run-multiclient-capacity.sh`、`docs/exec-plans/active/2026-09-03-multiclient-capacity-evidence.md`。
  - New dependencies: none。

## Failure model

| Failure mode | Required defence |
| --- | --- |
| 同用户两个浏览器互相静默覆盖布局 | revision 冲突测试、服务端发布 revision、客户端拉取最新权威布局 |
| 不同用户收到彼此会话布局 | hub 按 user ID 隔离的单元测试 |
| 1000 SSH panes 因单条 transport 的 OpenSSH `MaxSessions` 失败 | pool 分片测试：每 transport 最多 10 个 channel，总数仍受连接的 `max_sessions` 限制 |
| 并发建立连接时产生重复 transport、数据竞态或泄漏 | `go test -race`、并发 pool 测试、关闭后计数归零 |
| 真实 UI 看似成功但未建立分栏/未同步 | Playwright 隔离上下文容量脚本，统计布局 pane 数、同步延迟、页面/WS 错误与资源峰值 |
| 大布局同步破坏既有授权或接口 | 既有 layout 授权/409 回归测试和浏览器登录验收 |

## Scenarios

```gherkin
Feature: 同一登录用户的实时会话布局同步
  Scenario: 保存后的布局通知同一用户的其他浏览器
    Given 同一用户在浏览器 A 与浏览器 B 都已连接布局事件通道
    When  浏览器 A 以 revision 7 成功保存布局
    Then  浏览器 B 收到 revision 8，并加载 revision 8 的服务端布局

  Scenario: 不向其他用户泄露布局事件
    Given 用户 A 和用户 B 都已连接布局事件通道
    When  用户 A 成功保存布局
    Then  只有用户 A 的订阅者收到事件

  Scenario: 并发客户端不静默覆盖
    Given 两个客户端都持有 revision 7
    When  第一个客户端保存成功而第二个客户端随后保存
    Then  第二个保存收到 HTTP 409，服务端布局保持第一个客户端的内容

Feature: 高密度 SSH 会话容量
  Scenario: 一个连接在 100 个会话时分片但不超出总上限
    Given 连接的 max_sessions 为 100 且每个 SSH transport 最多 10 个 channel
    When  100 个会话并发取得 lease
    Then  恰好使用 10 个或更少的 transport，且没有一个 transport 超过 10 个 channel

  Scenario: 总会话上限仍然生效
    Given 连接的 max_sessions 为 10
    When  第 11 个会话请求 lease
    Then  请求被拒绝，既有 10 个会话不受影响

Feature: 真实浏览器容量
  Scenario: 10 个隔离浏览器上下文各恢复 10 标签和 10 分栏
    Given 一个隔离压测实例和允许 100 个 SSH 会话的受管连接
    When  容量脚本按批次建立 10 个浏览器上下文、每个 10 标签和每标签 10 分栏
    Then  脚本记录已连接 WebSocket 数、布局同步 p50/p95、错误数、CPU/RSS 峰值，并在超时或错误时非零退出
```

## Must NOT

- 不同步终端屏幕缓冲区或键盘输入：每一个 pane 均是独立的 SSH shell；本次“session 内容同步”定义为登录用户的可恢复布局（pane/tab/焦点）同步。
- 不降低已有 API 的授权、布局校验、256 KiB 请求限制或 revision 409 语义。
- 不将 SSH 密码、JWT 或本机私钥写入测试、日志、证据或版本控制。
- 不移除连接 `max_sessions` 总上限；容量测试使用隔离实例明确提高的上限。
- 不因压测直接修改生产 sshd 的系统配置。

## API / transport gates

- Scope: internal、greenfield WebSocket `/ws/layout`；既有 `/api/layout` JSON 字段和状态码不变。
- Boring: ✓ `/ws/layout` 与现有 `/ws/ssh/*` 一致，事件仅包含 `{revision}`。
- Compatibility: ✓ 仅新增 WebSocket route；既有 HTTP 路由不改。
- Authentication and authorization: ✓ 复用现有短期 JWT WebSocket 鉴权；服务端仅以已验证 token 的 user ID 订阅，不接受调用方传入的 user ID。
- Idempotency: N/A，事件订阅与读取不产生业务状态；布局保存仍由既有 revision 幂等冲突语义保护。
- Blast radius: ✓ 每用户订阅 channel 容量为 1，慢客户端只保留最新 revision；浏览器仅在 revision 提高时单次拉取。
- Pagination / expensive fields: N/A，事件不传布局内容；布局仍由既有单资源 GET 获取。
- No implementation leakage: ✓ 消费者只处理 revision，不依赖数据库表或 transport 分片。

## Revisions

- 2026-09-03: 初版。将用户所说的“多端同步 session 内容”明确为布局会话状态；终端 IO 同步不属于现有产品模型，不能用独立 SSH shell 冒充共享终端。
- 2026-09-03: 容量脚本改为用管理员凭据临时创建独立管理员，再在 finally 删除该用户；这样不会覆盖操作者或其他端正在使用的按用户布局。会话审计日志保留，符合现有审计模型。
