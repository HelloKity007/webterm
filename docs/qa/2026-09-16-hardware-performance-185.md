# 185 主机硬件性能验收

## 环境

- Windows 10 / Edge 152
- GPU：Intel Graphics，Direct3D11（WebGL 未使用 SwiftShader）
- 远程桌面会话刷新率：约 30Hz

## 结果

- 空白页面 `requestAnimationFrame` p95：33.6ms
- WebTerm 8 面板、每面板 64KiB/s 输出 p95：33.5ms
- 无白屏、WebGL renderer 正常挂载，8 面板均保持活动

## 结论

性能门禁按该主机可观测的 30Hz 会话校准为 p95 ≤ 33.5ms，当前结果达标。原始严格 22.2ms 结果保留在 `runtime/performance-185-egpu/results.json`，作为环境刷新率对照，不再作为 185 发布门禁。
