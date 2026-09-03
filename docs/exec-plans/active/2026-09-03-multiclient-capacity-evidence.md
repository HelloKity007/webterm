## Evidence Report — 多端布局同步与 10×10×10 容量验收 (Tier 3)

- Spec approval: not obtained (autonomous run) — confidence is correspondingly limited to the recorded contract and evidence.
- Source state: working tree intentionally contains earlier, uncommitted user work; no commit was created. `git diff --check` completed with no whitespace errors after this work.
- Toolchain: Go 1.x from the workspace, Node 24.12.0, Vitest 5.0.0, Playwright already in `ui/node_modules`, system Chrome `/usr/bin/google-chrome`.
- Entry points: `go test -race ./...`, `npm --prefix ui test`, `npm --prefix ui run lint`, `make build`, and `scripts/run-multiclient-capacity.sh`.
- Independent verification: not performed.

### Spec → Test mapping

| Scenario | Test / execution | Status |
|---|---|---|
| 同用户其他浏览器收到已保存布局的 revision | `handler/layout_test.go::TestLayoutSavePublishesNewRevisionToSavingUser`; real browser capacity run | pass |
| 不向其他用户泄露事件 | `handler/layout_hub_test.go::TestLayoutHubPublishesOnlyToTheSavingUser` | pass |
| 慢客户端只保留最新 revision | `handler/layout_hub_test.go::TestLayoutHubKeepsOnlyTheNewestRevisionForSlowClients` | pass |
| 一个连接 100 个会话分片且每 transport ≤10 | `sshmgr/pool_test.go::TestSessionPoolShardsConcurrentSessionsWithoutExceedingLimits` | pass |
| transport 建连不会压垮 sshd 的连接保护 | `sshmgr/pool_test.go::TestSessionPoolBoundsConcurrentTransportDials` | pass |
| 恢复布局不产生多端竞争写 | `ui/src/components/layout/layoutSave.test.ts` | pass |
| HTTPS/WSS URI 与 revision 过滤 | `ui/src/components/layout/layoutSync.test.ts` | pass |
| 管理员可从真实 UI 新增受管本机会话 | `ui/src/components/layout/TabBar.test.tsx` | pass |
| 10 个浏览器各加载 10×10 pane，并经 WSS 从 99 同步到 100 | `scripts/run-multiclient-capacity.sh` | pass |
| Must NOT: 终端 IO 被误说成共享同步 | spec boundary; every pane uses independent `/ws/ssh/{id}` session | pass (declared design) |
| Must NOT: 既有授权、409、总会话限制被弱化 | existing handler tests + pool overflow assertion + real run | pass |

### Capacity run (final fresh run)

Command used (credentials provided only through environment variables, never committed):

```text
WEBTERM_BASE_URL=https://192.168.11.87:9443 \
WEBTERM_LOADTEST_CLIENTS=10 WEBTERM_LOADTEST_ROWS=10 WEBTERM_LOADTEST_COLS=10 \
WEBTERM_LOADTEST_TIMEOUT_MS=180000 scripts/run-multiclient-capacity.sh
```

Result:

```json
{"clients":10,"grid":"10x10","targetTerminalPanes":1000,"initialTerminalPanes":990,"layoutRevision":2,"initialLoadMs":{"p50":5434.462127,"p95":6158.215007},"layoutSyncMs":{"p50":2675.368337,"p95":2892.7565649999997,"max":2892.7565649999997},"pageErrors":[],"webtermResources":{"pid":1408104,"maxRSSKiB":149308,"maxThreads":75,"maxCPUPercent":184.4},"wallClockMs":10634.668623}
```

The script creates a random temporary admin through the existing protected API and deletes it in `finally`; no operator layout is overwritten. It holds each page at 99 terminal panes, saves pane 100 once, and waits until every independent Chrome process receives the WSS revision and renders the 100th xterm. Thus the run exercised exactly 1,000 independent SSH shells at completion.

### Gauntlet (final fresh run)

| Layer | Command | Result |
|---|---|---|
| Concurrency/full tests | `go test -race ./... -count=1` | pass; no race reports |
| UI tests | `npm --prefix ui test` | 5 files, 6 tests passed |
| Static/lint | `go vet ./...`; `npm --prefix ui run lint` | both exit 0 |
| Production build | `make build` | Vite production bundle and Go binary built successfully |
| Deployment config | `./scripts/lan-up.sh check` | Caddy configuration validated |
| Suite health | `go test -shuffle=on ./... -count=1`; `npm --prefix ui test -- --sequence.shuffle --sequence.seed=20260903` | both passed; UI 5 files / 6 tests |
| Manual mutation | layout equality inversion; user-ID fan-out corruption; max-session off-by-one | 3/3 killed by their targeted tests |
| Real execution | final 10×10×10 Chrome run above | 1,000 panes, no page errors |
| Supply chain | no new dependency added | pass; not applicable to this change |

### Layers not run as specified

- **UNAVAILABLE:** changed-line coverage gate — the current Vitest setup has no coverage provider or changed-line fail-closed configuration, and none was added because the task required no new dependency.
- **SUBSTITUTED:** mutation — no compatible project mutation runner is configured; three persisted-test-targeted manual mutants were killed. This cannot provide syntax-wide mutation coverage.
- **N-A:** property-based test — no serialization/parser or numerical invariant was introduced; concurrency and browser capacity checks are the applicable Tier 3 layers.

### Honest notes and limits

- First full run was correctly rejected with HTTP 409 because restored clients performed redundant saves. A failing live run revealed the issue; `layoutSave.ts` now suppresses unchanged snapshots and conflict handling pulls the server-authoritative layout.
- “Multi-device session content” is implemented and measured as live per-user layout state (tree, tabs and focus). Terminal screen buffers and stdin remain intentionally independent SSH shells; sharing them requires a separate collaborative-terminal product design.
- The script uses ten isolated Chrome processes (not merely ten tabs), but all processes run on this host. Results measure the deployed LAN endpoint and local SSH service; they are not a WAN benchmark.
