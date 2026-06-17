# 🏆 2026 世界杯 · 赛程 + 预测 + 价值投注助手

一个本地运行的网页工具，帮你 **一眼看懂 2026 世界杯新赛制**，**预测任意两队比赛结果**，并基于实时赔率给出**正期望价值投注建议**。

美加墨世界杯是史上最大规模的一届（48 队 / 12 组 / 104 场），赛制改动很多——本项目把这些都做成了可视化。

## ✨ 功能

| 模块 | 说明 |
|------|------|
| **赛制** | 数字看板 + 新旧赛制对比表，30 秒看懂改动（48队、新增1/16决赛、8个最好第三名等） |
| **赛程** | 12 组单循环赛程，按比赛日查看，**点击比分即可录入结果** |
| **积分榜** | 12 组实时积分榜 + 第三名排行榜（自动算出线），含 FIFA 官方平分规则 |
| **淘汰赛** | 官方 1/16 决赛对阵模板（含"最好第三名"对位规则），随小组赛自动填充 |
| **预测助手** | 选任意两队，基于 **集成模型（Elo-Poisson + Dixon-Coles + xG）** 给出胜平负概率、预期进球、最可能比分、比分热力图、蒙特卡洛淘汰赛模拟 |
| **💡 价值投注** | 对比集成模型概率与 **the-odds-api 实时赔率**，用 **分数 Kelly 公式** 找出正期望投注，给出仓位/风险/预期回报 |
| **比分自动同步** | `npm run sync` 一键从 ESPN 拉取全部已完赛比分，**无需手动录入** |

## 🚀 如何运行

> ⚠️ 必须用本地服务器打开（直接双击 `index.html` 会被浏览器拦截 JSON 加载）。

**方式一：Python（macOS 自带，最简单）**

```bash
cd 世界杯
python3 -m http.server 8765
```

然后浏览器打开：**http://localhost:8765**

**方式二：Node**

```bash
npx serve .
# 或
npx http-server -p 8765
```

## 🧮 预测模型说明

预测采用 **三模型集成**（2022 卡塔尔世界杯回测 Brier score 提升 3.6%）：

1. **Elo-Poisson（基线）**：Elo 差 → 期望胜率 → 预期进球 → 独立泊松分布算比分概率。
2. **Dixon-Coles（核心）**：每队拆 attack/defense 双参数，加 0-0/1-0/0-1/1-1 低比分 τ 修正（独立泊松系统性低估低比分）；支持海拔修正、关键球员缺阵。
3. **xG-Poisson**：直接用攻防系数作 xG 代理。

三个模型按 25%/50%/25% 加权，再叠上海拔修正（墨西哥城 2240m 客队 xG × 0.92）、关键球员缺阵（attack/defense × 0.85）、东道主主场加成。

**建模要点**：
- 世界杯除东道主外均为**中立场**，所以默认无主场加成；仅东道主球队（美/加/墨）有主场加成。
- 平局率约 25%，强对弱胜率最高约 88%，最常见比分通常是 1-0 / 1-1 / 0-0——均符合足球实际统计。
- 淘汰赛阶段用**蒙特卡洛模拟**（10000 次），按比分概率抽样，平局走 Elo 加权点球大战。

> 这是有依据的概率模型，但足球充满不确定性，结果仅供娱乐参考。

## 💡 价值投注助手（v2 新增）

对比集成模型概率与市场赔率，找出 **正期望投注**——也就是模型认为发生概率高于市场定价的赛果。

**核心公式**：
- `edge = 模型概率 / 市场隐含概率 - 1`，edge > 0 即价值投注
- `Kelly f* = (b·p - q) / b`，最大化长期资金增长率的最优仓位
- 默认用 **1/4 Kelly**（业界标准），单注上限 5%，最小 edge 阈值 3%

**市场数据**：从 [the-odds-api](https://the-odds-api.com) 拉 Pinnacle / Bet365 / DraftKings 等多家 bookmaker 的 h2h（胜平负）、spreads（让球）、totals（大小球）三条线，聚合去 vigorish（用 Shin 1993 方法，比简单归一化更准）。

> ⚠️ the-odds-api 不提供"正确比分"市场，所以比分盘价值靠模型 grid 计算。

**使用步骤**：

```bash
# 1. 去 https://the-odds-api.com 注册（免费，500 次/月额度），拿到 API key
# 2. 设置环境变量
export ODDS_API_KEY=你的key

# 3. 同步赔率到 data/odds.json
node scripts/sync-odds.mjs

# 4. 刷新网页 → 「💡 价值投注」Tab
```

**设置**：可在页面顶部调整本金、Kelly 分数（1/8 极保守 / 1/4 推荐 / 1/2 进取 / 完整 Kelly）、最小 edge 阈值。设置存 localStorage 跨会话保留。

> ⚠️ **免责声明**：本工具是数学/教育性质，输出基于公开赔率和统计模型，**不构成实际投注建议**。投注在你所在的司法管辖区可能违法。模型有偏差，市场通常更对，请理性、量力而行。

## 📁 项目结构

```
世界杯/
├── index.html                  # 入口
├── css/style.css               # 样式（深色足球主题）
├── data/
│   ├── worldcup2026.json       # 数据集：48队 / 12组 / 赛程 / Elo / teamStrength / venues / keyPlayers
│   ├── results.json            # sync.mjs 自动写入的已完赛比分
│   └── odds.json               # sync-odds.mjs 写入的实时赔率
├── sync.mjs                    # ★ ESPN 比分同步脚本（npm run sync）
├── scripts/
│   ├── autosync.mjs            # launchd 定时同步安装器（npm run autosync:install）
│   ├── sync-odds.mjs           # ★ the-odds-api 赔率同步脚本
│   ├── backtest.mjs            # 2022 世界杯模型回测（Brier / LogLoss / 准确率）
│   ├── wc2022.mjs              # 2022 卡塔尔世界杯历史数据
│   └── test-valuebet.mjs       # 价值投注链路端到端测试
├── logs/                       # 定时同步的运行日志（自动生成）
├── js/
│   ├── app.js                  # 主入口、Tab/Hash 路由
│   ├── data.js                 # 数据加载层（合并 results/odds/localStorage）
│   ├── model/
│   │   ├── elo.js              # Elo 期望得分 / 更新 / K 值校准
│   │   ├── poisson.js          # 独立泊松（基线 / 集成成员）
│   │   ├── dixonColes.js       # ★ 双参数 attack/defense + 低比分 τ 修正
│   │   ├── ensemble.js         # ★ 三模型集成（25/50/25 加权）
│   │   ├── monteCarlo.js       # ★ 蒙特卡洛淘汰赛模拟
│   │   ├── odds.js             # ★ 赔率 → 隐含概率（Shin 去 vig）
│   │   └── valuebet.js         # ★ 价值识别 + 分数 Kelly 仓位
│   └── views/                  # 六个视图
│       ├── format.js           # 赛制
│       ├── schedule.js         # 赛程（含比分录入编辑器）
│       ├── groups.js           # 积分榜
│       ├── bracket.js          # 淘汰赛对阵图
│       ├── predictor.js        # 预测助手（集成模型 + 蒙特卡洛）
│       └── valuebets.js        # ★ 价值投注每日建议
├── test/verify.mjs             # 验证脚本（数学 + 数据层）
└── package.json
```

## 🔧 日常使用

### ⚡ 比分自动同步（推荐）

```bash
npm run sync        # 或 node sync.mjs
```

一条命令拉取 ESPN 全部已完赛比分，写入 `data/results.json`。之后打开网页，**赛程、积分榜、出线形势、淘汰赛对阵全部自动更新**——你完全不用手动录入。

- 数据源：ESPN 非官方 API，**无需 API key、无需注册**
- 同步后刷新网页即可看到最新比分
- 覆盖：小组赛比分 + 完整淘汰赛对阵（R32→R16→QF→SF→决赛→季军赛）

### 🕐 完全自动定时同步（可选，装一次就不用管了）

```bash
npm run autosync:install    # 安装：每小时自动同步一次 + 每次开机时同步
npm run autosync:status     # 查看状态与最近日志
npm run autosync:uninstall  # 卸载
```

基于 macOS 原生 launchd（比 cron 更健壮，睡眠唤醒后会补跑）。安装脚本会自动探测 node 路径（含 nvm）和项目路径，无需手动改配置。日志在 `logs/sync.log`。

装好后，你每天打开电脑、每小时整点过后，比分都会自动同步——打开网页永远是最新结果，**彻底零手动**。

### ✍️ 手动录入/修正（可选）

- 「赛程」页点中间比分区域仍可手动录入——用于修正自动数据，或在同步前先填上你已知道的比分
- 手动录入存浏览器 localStorage，**优先级高于自动同步**（你改的不会被同步覆盖）
- 底栏「重置比分」清空 localStorage（不影响 `results.json`）

### 📋 查看出线形势

「积分榜」页：绿底=小组前2出线，蓝底=最好的第三名出线；底部"第三名排行榜"实时显示哪 8 个第三名能晋级。

## 🔄 数据更新与接入 API

比分默认走上面的 **ESPN 自动同步**（已配置好，开箱即用）。数据层完全隔离在 `js/data.js`，两层合并：

```
data/results.json（sync.mjs 自动写）  ← 基础
        ＋
localStorage（你的手动修正）          ← 覆盖前者
```

想换数据源（如 football-data.org / API-Football）？只改 `sync.mjs` 的拉取逻辑，**网页代码完全不用动**。需要映射的字段：
- `teams[]`：`id` / `nameCn` / `flag` / `group` / `elo`
- `results{}`：键为 `G:组名:队A-队B`，值为 `{a, b, hs, as}`

## ✅ 验证

```bash
node test/verify.mjs   # 14 项断言：Elo数学、泊松概率、赛程生成、积分计算
```

## 📌 数据来源与说明

- 分组、赛制、R32 对阵模板来自 FIFA / 公开报道（NBC Sports、Al Jazeera、维基百科等）。
- Elo 评分为基于 FIFA 排名的估算值，用于驱动预测模型，非官方数据。
- 库拉索、佛得角、乌兹别克斯坦、约旦是本届世界杯新军。

---

祝你看球愉快！⚽
