# Claude 小屏输入区回归：未完成验收

测试候选：`746e91f55a9d0d1845517904e83469d6f404c1a7`，仅 9444。
生产 9443 未部署、未重启。

根因：小屏本地 19 行与 tmux 实际 103×29 不一致，ANSI 页底坐标被夹到本地末行。候选在绘制快照前接受服务端网格，避免输入区、状态行互相覆盖。

执行 headed Chrome / Xvfb，1920×1080、2860×988、3440×1440；每组上滚 8 次、下滚 12 次。三组往返前后网格一致，无 pageerror、无画布边界裁切。截图中输入提示符、模型、Context 和 permissions 均可见。证据：`runtime/claude-composer-qa/`，重跑 `xvfb-run -a node scripts/verify-claude-composer.mjs`。

额外在 1920 上往返后输入 `WT_COMPOSER_QA`，截图确认出现在提示符旁，随后逐字符 Backspace 删除，未按 Enter、未发起 Claude 任务。证据 `1920-input.png`、`1920-input-cleaned.png`。

**结论：DO NOT SHIP。** 网格坐标修正有效，但不能等同整体体验 PASS：小屏字体偏小、右侧及底部出现明显留白，输入后布局仍需继续验证。往返后右侧余量分别约 90 / 300 / 9 px，不符合既有自然字号及铺满要求。几何脚本仅断言不裁切，不验证这些视觉要求，也不替代用户物理屏幕复检。尚未完成手机及 SSH 全回归，不允许生产发布。

## 最大可容纳字号候选 f3394a1

用户随后确认内容完整，要求在正常显示前提下尽可能铺满。现在保持服务端网格和自然字距，对实际渲染结果二分搜索最大可容纳字号，而不是只按比例缩小。仅部署 9444。

103 项 UI 测试、lint、build、Go 全测试通过。headed Chrome 的 1920/2860/3440 历史往返稳定后均无裁切或 pageerror，截图中的输入内容、模型、Context、permissions 可见。证据 `runtime/claude-maxfont-settled-qa/`。移动端 6 项 smoke 通过，物理手机未验收。opencli 真实 Chrome 的截图、DOM 已检查，证据 `runtime/claude-maxfont-qa/opencli.png`；browser-use 不在 PATH，未声称执行该工具。

改善有限，不能声称消除了全部留白：DPR=1 时，1920 和 2860 的边界余量与上一版相同；3440 底部余量由约 93px 减为 62px。真实 Chrome DPR≈1.2 的 2860 画布为 685×410。共享网格固定、字形不拉伸且字号受宽高较紧的一边限制，因此另一边可能仍有留白；xterm 整物理像素字宽也限制了连续放大。待用户复检，不作全产品 PASS 或生产发布授权。
