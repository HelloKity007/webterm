# Changelog

## [1.1.0] - Unreleased

### File workspace

- 用统一“文件”工作区替代工具栏中的独立 SFTP 与 SSH 文件列表入口，并兼容旧版持久化模块状态。
- 重新设计本地/远程双栏界面，加入路径导航、实时筛选、万级目录窗口化、多选、键盘操作、任务状态和响应式布局。
- 支持同端点复制/剪切/粘贴，以及本地与 SFTP、不同 SFTP 连接之间的递归流式传输。
- 上传和下载改为有界内存的流式处理；下载使用 30 秒单次票据，不再在 URL 中暴露长期 JWT。
- 递归操作拒绝根目录、符号链接、源目标相同和目录自嵌套；默认不覆盖已有目标，失败会保留源并清理新建的残留目标。

### Security

- 本地和 SFTP 文件操作新增路径规范化、根目录保护、结构化批量结果与连接级授权复核。

### Release boundary

- 本节描述开发候选；生产环境 `9443` 仍需在测试环境完整验收后获得本候选的单独批准。

## [1.0.6] - 2026-09-13

### Security

- 登录界面不再把用户名作为 HTML 注入，消除登录前 DOM XSS 路径。
- “记住密码”改为只记住用户名，并在客户端启动时删除旧版遗留的明文密码。
- 升级 React Router，修复依赖审计报告的高危与中危漏洞。
- 最低 Go 工具链提升到 1.26.6，并升级 `golang.org/x/crypto`，修复 SSH
  调用链与标准库漏洞扫描结果。

### Reliability

- 在真实 SSH + lrzsz 端到端门禁完成前，明确拒绝 ZMODEM `rz` 上传并提示使用 SFTP，避免会话卡死；`sz` 下载路径暂时保留。
- 新增 push、pull request 与 tag 发布共用的前端、Go race/vet 和依赖漏洞 CI 门禁。

### Release boundary

- 本节记录 1.0.6 安全加固基线。

## [0.1.0] - 2026-05-24

WebTerm 首个版本，基于 React + Go 的 Web 运维工具箱。

### 核心功能

- **SSH 终端** — xterm.js 渲染，256 色 / TrueColor，支持多标签页、无限分屏、广播模式
- **SFTP 文件管理** — WinSCP 风格双栏布局，跟随 SSH 终端自动同步路径，拖拽上传 / 下载
- **数据库管理** — MySQL 查询编辑器（CodeMirror 6 + SQL 方言），表浏览，内联编辑，结果导出 CSV
- **本地文件** — WebSocket 通道访问服务器本地文件系统

### 用户系统

- 登录认证（JWT），admin / user 双角色
- 连接按用户隔离，支持公共连接共享
- 凭据 AES-256-GCM 加密存储

### 界面

- Tokyo Night 主题 + 多种预设配色方案
- VS Code Activity Bar 风格导航
- 关键字高亮、终端内搜索 (Ctrl+F)、sz/rz 文件传输
- 页面刷新持久化标签页和分屏布局
- Matrix Rain 动态背景 + ASCII art "WEBTERM" banner

### 运维特性

- SSH 连接池引用计数，断线自动重连
- OSC 7 协议追踪 shell 工作目录
- WebSocket 心跳 + 指数退避重试

### 部署

- Go 单二进制文件，前端静态资源内嵌
- 跨平台：Linux (amd64/arm64)、macOS (amd64/arm64)、Windows (amd64)
- Docker 多架构镜像 (`ghcr.io/xufanchn/webterm`)
- systemd 服务单元 + 启动脚本（start/stop/restart/status）
- GitHub Actions 自动发布：`git tag v* && git push --tags`
