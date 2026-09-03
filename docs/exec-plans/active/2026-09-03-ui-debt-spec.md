# UI 清债：可执行规格

**状态：执行中。** 规格批准：未单独取得；根据用户“清债，TDD 100%通过交付版本”自主执行。

## 范围与约束

- 不新增运行时或测试依赖；使用现有 ESLint、Vitest、TypeScript 和 Chrome 自动化。
- 不改变 SSH、SFTP、布局 API 或 LAN 部署对外契约。
- 现有工作树包含未提交的产品交付改动，因此不新建 worktree；仅触碰 lint 报告所指向的 UI 文件和本规格/证据文件。
- 不降低 ESLint 规则、不加入忽略项、不删除断言来换取通过。

## 可执行验收场景

1. 当 WebSocket 回调在重新渲染后发生时，连接层必须调用最新回调，且重连仍调用有效的 `connect`；Vitest 覆盖打开、消息和关闭/重连路径。
2. 当 React 组件需要同步 callback/ref 时，必须在 effect 中完成，不能在 render 阶段读写 `ref.current`；相应 UI 行为保持可用。
3. 当用户打开、恢复、关闭或分割 tab 时，布局保存和现有终端 UI 行为不回归；既有布局单测与浏览器用例覆盖。
4. 所有 UI 源码满足现有 ESLint 配置（零 error、零 warning），且 TypeScript 生产构建成功。
5. 交付前，Go 全测、Vitest、ESLint、生产构建和生产 Caddy 的浏览器登录/SSH/OCR 路径均通过。

## 负面约束

- 不隐藏 lint 失败，不将规则降级为 warning/disabled。
- 不将 WebSocket、终端或文件操作替换为 mock-only 实现。
- 不在仓库或测试输出写入部署密码或其他 secret。

## 验证矩阵

| 场景 | 主要证据 |
|---|---|
| WebSocket 生命周期 | 新增 Vitest 回归测试 + browser SSH |
| Render/ref 规则 | ESLint + 相关组件 Vitest |
| 类型/空块规则 | ESLint + TypeScript build |
| 全局交付 | `go test ./...`、`npm --prefix ui test`、`npm --prefix ui run lint`、`npm --prefix ui run build`、Chrome 截图/OCR |

## 执行证据

- 基线：`npm --prefix ui run lint` 报告 **123 errors / 11 warnings**；清理范围覆盖 22 个 UI 文件。最终全局 lint 为零 error、零 warning。
- RED→GREEN：新增 `ui/src/hooks/useWebSocket.test.tsx`。首次行为断言通过，随后将 `onmessage` 的回调调用故意移除；Vitest 按预期失败（最新回调为 0 次）。恢复并重构为 effect 同步 callback ref、通过 `connectRef` 进行重连后，测试通过，且该 hook lint 为零。
- TDD 行为：`useWebSocket` 覆盖“更新回调后不重新建连、收到消息交给最新回调”；已有布局持久化测试继续覆盖保存/恢复 JSON 结构。
- 静态门禁：无规则禁用、无 lint 忽略或降级；所有 `any`、render 期 ref 写入、同步 effect 更新、空 catch 和不稳定 ID 生成均替换为有类型/异步/事件安全的实现。
- 最终浏览器：Chrome 通过生产 Caddy HTTPS 登录 admin，恢复受管 SSH tab 并挂载 xterm；视觉/OCR 截图 `/tmp/webterm-qa/ui-debt-final-production.png` 显示 `本机 127.0.0.1`、`/home/pgz` 和 shell prompt。

## Gauntlet 限制

- 覆盖率：工程未配置 changed-line coverage gate，本次未声称覆盖率百分比。
- mutation：未引入 mutation runner；仅对新增 WebSocket 回归测试执行了一个明确的手工 mutant，证明其失败路径。
- 依赖：未新增依赖；既有 Vitest、TypeScript、ESLint 与 Chrome DevTools 自动化用于本次验证。
