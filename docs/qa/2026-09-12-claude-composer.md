# Claude 小屏输入区回归：未完成验收

测试候选：`746e91f55a9d0d1845517904e83469d6f404c1a7`，仅 9444。
生产 9443 未部署、未重启。

根因：小屏本地 19 行与 tmux 实际 103×29 不一致，ANSI 页底坐标被夹到本地末行。候选在绘制快照前接受服务端网格，避免输入区、状态行互相覆盖。

执行 headed Chrome / Xvfb，1920×1080、2860×988、3440×1440；每组上滚 8 次、下滚 12 次。三组往返前后网格一致，无 pageerror、无画布边界裁切。截图中输入提示符、模型、Context 和 permissions 均可见。证据：`runtime/claude-composer-qa/`，重跑 `xvfb-run -a node scripts/verify-claude-composer.mjs`。

额外在 1920 上往返后输入 `WT_COMPOSER_QA`，截图确认出现在提示符旁，随后逐字符 Backspace 删除，未按 Enter、未发起 Claude 任务。证据 `1920-input.png`、`1920-input-cleaned.png`。

**结论：DO NOT SHIP。** 网格坐标修正有效，但不能等同整体体验 PASS：小屏字体偏小、右侧及底部出现明显留白，输入后布局仍需继续验证。往返后右侧余量分别约 90 / 300 / 9 px，不符合既有自然字号及铺满要求。几何脚本仅断言不裁切，不验证这些视觉要求，也不替代用户物理屏幕复检。尚未完成手机及 SSH 全回归，不允许生产发布。
