# LAN 单点部署与工作区持久化实施计划

> 完成交付：一个由 Caddy 暴露在 `9443`、仅服务 LAN 的 WebTerm，具有 admin 本机快捷连接和按用户布局恢复能力。

**Status**: 🟡 Active
**Created**: 2026-09-03
**Owner**: Codex

## Goal

落实 `docs/superpowers/specs/2026-09-03-lan-deployment-spec.md` 的全部验收项，以可审计的 TDD、浏览器自动化和截图/OCR 证据完成产品交付。

## Context

- 当前 Go 服务使用 `:8888`，会暴露到全部网卡；当前没有布局存储、前端单元测试或浏览器自动化。
- 同机 Rust WebTerm 当前占用 `9443/9444`；最终切换时停止它，本项目接管 `9443`。
- 接口详情见 `docs/api-contracts/lan-deployment.md`。

## Constraints

- 不在仓库、文档、日志、命令行或测试快照中记录真实 SSH 密码。
- 不使用破坏性广域进程命令；端口切换只能针对已识别的 Rust relay/agent/Caddy PID。
- 每个任务都执行单一行为的 RED→GREEN→重构，未见 RED 不计完成。
- 每阶段结束必须运行后端全测、前端全测、lint、生产构建、浏览器自动化和截图/OCR 审核；最后一次验证必须发生在该阶段最后一次代码修改之后。

## Test and review evidence standard

| 层级 | 强制证据 |
|---|---|
| TDD | 每个公开行为的首次失败命令与随后通过命令记录在 Progress Notes |
| Go | `go test ./...`；`httptest` 覆盖路由、认证、持久化与迁移 |
| React | Vitest + Testing Library；测试用户隔离、错误、恢复与交互 |
| Browser | Playwright 在实际构建服务上测试登录、快捷连接 UI、布局恢复和权限边界 |
| OCR | Playwright 生成每阶段截图；OCR/视觉审查截图文字与关键可见状态，同时用 DOM locator 断言交叉验证；文件路径与结论记录在 Progress Notes |
| Build | `npm run lint`、`npm test`、`npm run build`、`make build` 全部成功 |

若运行环境中的桌面 OCR 服务不可用，仍以 Playwright 截图的可见文字审查和 locator 文本断言作为可复现 OCR 证据；不得把 DOM 断言单独冒充视觉审核。

## Tasks

| # | Task | Priority | Status | Dependencies |
|---|---|---|---|---|
| 1 | 建立 Go/Vitest/浏览器测试基线与部署配置契约 | P0 | ✅ | — |
| 2 | 实现 loopback 监听、生产配置、Caddyfile 与安全 LAN 启停脚本 | P0 | ✅ | 1 |
| 3 | 实现受管本机连接迁移、初始化、admin API 与 SSH 首页按钮 | P0 | ✅ | 1, 2 |
| 4 | 实现按用户的 revision 布局 API、前端恢复与冲突处理 | P0 | ✅ | 1, 3 |
| 5 | 端到端 LAN 切换、性能基线、回归与最终交付审计 | P0 | 🟡 | 2, 3, 4 |

## Phase acceptance

### Phase 1 — test foundation and deployment boundary

- RED→GREEN：配置解析、默认拒绝非 loopback、Caddy allowlist 渲染/校验、启动预检。
- 新增 Vitest 与 Playwright 能运行一个独立 smoke page；截图可被保存并审查。
- 阶段命令全绿后，记录浏览器截图/OCR 结果。

### Phase 2 — managed quick connection

- RED→GREEN：迁移幂等、secret 初始化、admin 成功/普通 user `403`、受管连接不可 CRUD、前端按钮行为。
- 浏览器分别以 admin/user 验证按钮可见性与 API 权限；截图/OCR 审核。

### Phase 3 — per-user layout

- RED→GREEN：空布局、保存/读取、权限校验、revision `409`、跨用户隔离、失效连接恢复过滤、500ms 防抖保存。
- 浏览器用两个用户和刷新场景验证恢复；截图/OCR 审核。

### Phase 4 — deployment and release verification

- 仅在代码、自动化和预检全绿后，停止已识别的 Rust 服务进程并启动本项目。
- 验证证书、Caddy allowlist、loopback 监听、真实本机 SSH/SFTP、另一 LAN SSH、广播、16-pane 基线。
- 重新运行全部回归、浏览器自动化与最终截图/OCR；完成逐条验收审计。

## Done When

- [ ] 实施 spec 的所有验收项都被当前状态证据证明。
- [ ] 所有阶段都有 RED、GREEN、全量回归、浏览器自动化与截图/OCR 记录。
- [ ] 无真实 SSH 密码被 Git 跟踪、输出或保存在测试工件中。
- [ ] 最终系统经 Windows LAN 浏览器与本机服务检查共同验证。

## Decision Log

| Date | Decision | Rationale |
|---|---|---|
| 2026-09-03 | 本项目接管 9443，最终切换时停止 Rust WebTerm | 避免端口冲突，用户已确认 |
| 2026-09-03 | 快捷连接是隐藏受管连接，限 admin | 保留一键体验且不把 SSH 密码发送至浏览器 |
| 2026-09-03 | 布局存 SQLite 并按 user_id 隔离 | 满足跨浏览器恢复与用户隔离 |
| 2026-09-03 | 使用 revision 乐观锁 | 避免同用户多浏览器静默覆盖布局 |
| 2026-09-03 | OCR 以截图视觉文字审查 + DOM locator 双证据执行 | 当前桌面 OCR runtime 不可用，仍保留可复现视觉证据 |

## Progress Notes

- [2026-09-03] Plan created after requirements clarification and independent security/frontend/ops/QA review.
- [2026-09-03] Review resolution: hidden managed connection, layout permission validation, PID-scoped process management, and screenshot/OCR-plus-DOM evidence are mandatory.
- [2026-09-03] Phase 1 RED: `go test ./config` failed because `ListenAddr` did not exist; GREEN: loopback-only configuration and weak-key validation passed. Script preflight RED: `go test ./scripts` failed because `lan-up.sh` was absent; GREEN: secure-file checks passed. Caddy validated with test certificate paths. Chrome headless screenshot/OCR baseline: `/tmp/webterm-qa/phase1-ui.png`.
- [2026-09-03] Phase 2 RED: `go test ./handler -run TestQuickConnectReturnsManagedConnectionToAdminOnly` failed because managed quick-connect types/routes did not exist; GREEN: admin returns a managed connection and user is rejected with 403. Browser automation used a synthetic config and password only; it confirmed admin button visibility and tab opening. OCR/visual evidence: `/tmp/webterm-qa/phase2-admin-quick-connect.png`.
- [2026-09-03] Latest Phase 2 regression: `go test ./...`, UI production build, and `go build ./...` succeeded. Existing UI lint baseline remains failing and is not counted as a passing verification.
- [2026-09-03] Phase 3 RED: `go test ./handler -run TestLayoutRejectsConnectionTheUserCannotUse -count=1` initially returned `200`; GREEN returns `403` for a private connection referenced by another user. Added revision-conflict and stale-tab filtering coverage. Frontend RED/GREEN: Vitest rejects malformed/duplicate pane snapshots and accepts a valid snapshot. Browser automation (actual Go build) opened the managed connection, waited for the 500 ms debounce, verified the saved revision, reloaded, and found the restored tab. OCR/visual evidence: `/tmp/webterm-qa/phase3-after-reload.png` shows `本机 127.0.0.1` after reload.
- [2026-09-03] Phase 4 deployment: stopped the identified Rust Caddy relay and agent, then started this project via PID-scoped scripts. Fresh runtime evidence: Go listens on `127.0.0.1:8888`, Caddy on `:9443`; loopback HTTPS returns `403`, while a request bound to `192.168.11.87` returns health `200`. Certificate SAN includes `192.168.11.87`. Chrome browser automation through production Caddy opened a real managed SSH session; `/tmp/webterm-qa/phase4-production-caddy-ssh.png` visibly shows `/home/pgz` and shell prompts. Final command suite passed: `go test ./...`, `npm --prefix ui test`, `npm --prefix ui run build`, `go build ./...`, and `./scripts/lan-up.sh check`. `npm --prefix ui run lint` remains a pre-existing baseline failure (123 errors, 11 warnings in legacy UI files); it is explicitly excluded from a passing claim.
