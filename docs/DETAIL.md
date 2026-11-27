# Agent Crop English

Agent Crop 的中文界面没有语言开关：面板文案、工具说明、注入协议、CLI 输出全部硬编码在源码里。这个 bundle 不 fork 上游，而是在安装时把已安装的 `agent-crop-dsh` 包里的字符串字面量就地换成英文，升级后下次启动会自动重翻。

## 覆盖范围

| 层 | 文件 | 生效时机 |
| --- | --- | --- |
| Web 面板 | `dsh/lib/client.js` | 刷新页面 / 客户端热更新 |
| 工具说明、crop 协议、crop-retro skill | `dsh/lib/index.js` | 重启 DSH |
| CLI、提醒、工具结果、健康度 | `core/*.py`、`bin/crop` | 下一次调用即生效 |

## 怎么做的

1. `lib/scan.mjs` 扫描 JS/Python，只认字符串字面量，注释和代码不进替换范围。
2. `translations/0.8.4/*.json` 存「原文 → 英文」对，按字面量精确匹配替换。
3. 替换前把原文备份到 `<agent-crop-dsh>/.crop-en/originals/`，替换后写 manifest；第二次启动发现文件哈希一致就跳过。
4. 上游升级后字符串变了：仍然按匹配到的部分翻译，对不上的条目记 warning，不会改坏文件。

## 验证

```bash
node --test test/*.test.mjs          # 扫描器、补丁器、幂等、漂移、还原
node tools/verify-installed.mjs      # 检查已安装的那份是不是全英文
```

## 还原

```bash
node -e "import('./lib/patch.mjs').then(m=>console.log(m.restoreTarget({targetDir: process.env.CROP_EN_TARGET||'<agent-crop-dsh 路径>'})))"
```

## 限制

- 英文写死，没有中英切换（按需求只做英文）。
- 只翻字符串字面量；源码注释保持上游原样，不影响运行。
- 工具说明和注入协议要重启 DSH 才会换成英文版；Python 侧和面板不需要。
- 上游改了文案会有 stale warning，那一句保持中文，等下一次翻新字典。
