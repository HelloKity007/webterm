# WebTerm M2 工作区 Tab 验收证据

> 日期：2026-09-05  
> 分支：`dev-1.0.1`  
> 功能提交：`f812186`、`e8f2eef`  
> 发布测试环境：`https://192.168.11.87:9444/`

## 1. 验收范围

- schema v1 单布局无损迁移为 schema v2 的第一个工作区 Tab。
- 工作区 Tab 固定正整数索引、共享名称和独立 pane 布局。
- 新建默认空白 1 pane；用户显式选择时复制当前布局。
- 复制生成新的 workspace、pane、session Tab/terminalID，仅复用连接、标题和显示编号。
- 切换工作区不调用 terminal-session DELETE，隐藏 tmux 会话继续存活。
- 两个浏览器共享工作区集合但保持各自 active workspace；刷新与发布测试服务重启后恢复。
- 重命名覆盖 Enter、Escape、失焦空白、重复名、超长边界和 HTML 特殊字符文本渲染。

## 2. TDD 记录

### RED

1. 新增 schema v2 和工作区组件测试时，`workspaceLayout`、`WorkspaceTabBar`、后端 schema v2 验证函数均不存在，前后端测试按预期失败。
2. 首轮真实浏览器 8-pane 流程发现：复制布局后多个 xterm mount 会抢走工作区重命名输入框焦点，导致输入框在填写前因 blur 消失。
3. 为焦点问题增加 `shouldAutoFocusTerminal` 测试，初始因函数不存在而失败。

### GREEN

- 实现纯函数迁移/归一化/共享快照/本地选择合并/创建/复制/重命名。
- 后端同时兼容 schema v1/v2，并对所有 workspace 执行连接授权、共享字段清理和 ID/index 校验。
- xterm 自动聚焦在已有 input/textarea/select/contenteditable 获得焦点时让位；显式终端操作仍可正常聚焦。
- 最终 UI：20 个测试文件、68 个测试全部通过。

## 3. 最终自动化门禁

| 门禁 | 结果 |
|---|---|
| `go test -race ./... -count=1` | PASS |
| `go test -shuffle=on ./... -count=1` | PASS |
| `go vet ./...` | PASS |
| `npm --prefix ui test` | PASS：20 files / 68 tests |
| `npm --prefix ui run lint` | PASS |
| `npm --prefix ui run build` | PASS |
| `make build` | PASS |
| `node --check scripts/verify-workspace-tabs.mjs` | PASS |
| `git diff --check` | PASS |

## 4. 真实浏览器自动化结果

使用系统 Google Chrome/Chromium 内核、Playwright 多独立 browser context、临时随机 QA 账号和发布测试数据库执行。测试账号、布局记录和测试 tmux 在结束后清理。

最终一次完整运行结果：

```json
{
  "schemaVersion": 2,
  "workspaceIndexes": [1, 2, 3],
  "workspaceNames": ["workspace", "blank & qa", "<b>production & qa</b>"],
  "v1TerminalsRetained": 8,
  "copyUsesIndependentTerminalIDs": 8,
  "hiddenTmuxSessionsRetained": true,
  "independentBrowserSelection": true,
  "persistedAfterReleaseTestRestart": true,
  "reauthenticatedAfterReleaseTestRestart": true,
  "terminalSessionDeletes": 0,
  "pageErrors": [],
  "consoleErrors": [],
  "failedResponses": []
}
```

自动化覆盖：

- schema v1 的真实 2×4 / 8-pane 布局迁移后，8 个 pane、session Tab 和 terminalID 全部保持。
- 创建第二个工作区时默认 radio 为“空白”，且页面不存在被复制的终端。
- Escape 取消重命名；空白名称失焦保留原名；Enter 提交普通名和 HTML-like 名称。
- 第三个工作区显式复制 8-pane，生成 8 个全新的 terminalID；原 8 个 tmux 均存活。
- A/B 两浏览器收到相同三个工作区，但分别停留在工作区 2 和 3，没有互相抢 active workspace。
- 桌面 `1440×900` 与移动 `390×844` 均无 document/body 横向溢出；工作区名称按文本显示。
- 刷新恢复三个工作区；重启 9444 后按当前基线重新登录，schema v2、名称、索引、各布局和 tmux 会话仍存在。
- 全流程没有调用 `DELETE /api/terminal-sessions/...`。

截图工件：

- `/tmp/webterm-workspace-tabs-desktop.png`
- `/tmp/webterm-workspace-tabs-mobile.png`

截图已人工检查工作区栏、8-pane 网格、固定编号、长名称截断和移动 viewport。项目当前没有提交像素基线，因此本次不宣称像素级 visual-regression comparison；该比较不属于 M2 功能验收门禁。

## 5. 清理与环境隔离

- 发布测试临时用户名计数：`0`。
- 临时 userID 对应的 `wt-<user>-*` tmux 计数：`0`。
- 正式环境仍为 `1cb938f`，未提升候选。
- 发布测试环境健康检查为 `environment=release-test`。

## 6. 结论

M2 工作区 Tab 的 Spec `TAB-*` 与 `E2E-TAB-1` 在发布测试环境通过。下一阶段进入 M3：WS upgrade 前 ticket/Origin 授权与单写者。
