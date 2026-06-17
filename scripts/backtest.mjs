// ===== 模型回测脚本 =====
// 用 2022 卡塔尔世界杯 64 场比赛回测三个模型 + 集成模型。
// 评估指标：
//   - Brier score（多分类版，胜/平/负三档）：越低越好
//   - Log loss：越低越好
//   - 准确率（胜平负三选一）：越高越好
//
// 运行：node scripts/backtest.mjs
//
// 解读：Brier 多分类的理论"全随机猜（33/33/33）"≈ 0.667，
// 真实顶级模型 ≈ 0.55-0.58；我们能拿到 0.58 左右就算合格。

import { wc2022 } from './wc2022.mjs';
import { predict as poissonPredict } from '../js/model/poisson.js';
import { predictDC } from '../js/model/dixonColes.js';
import { predictEnsemble } from '../js/model/ensemble.js';
import { readFileSync } from 'node:fs';

const data = JSON.parse(readFileSync(new URL('../data/worldcup2026.json', import.meta.url)));

// 给 2022 队伍构造一个最小 data-like 对象（attack/defense 从 2026 配置取，缺失用 Elo 推）
function strengthFor(id, elo) {
  const s = data.teamStrength[id];
  if (s) return s;
  const k = (elo - 1700) / 400;
  const v = Math.max(0.6, Math.min(1.6, 0.9 + 0.5 * k));
  return { attack: v, defense: v };
}

function actualOutcome(m) {
  // winner 优先（点球大战）；否则按 90 分钟比分
  if (m.winner) return m.winner === 'h' ? 'home' : 'away';
  if (m.hs > m.as) return 'home';
  if (m.hs < m.as) return 'away';
  return 'draw';
}

// 多分类 Brier：Σ (p_i - y_i)^2，y 是 one-hot
function brier(pred, actual) {
  const y = { home: actual === 'home' ? 1 : 0, draw: actual === 'draw' ? 1 : 0, away: actual === 'away' ? 1 : 0 };
  return (pred.win - y.home) ** 2 + (pred.draw - y.draw) ** 2 + (pred.lose - y.away) ** 2;
}

function logLoss(pred, actual) {
  const eps = 1e-9;
  const p = actual === 'home' ? pred.win : actual === 'draw' ? pred.draw : pred.lose;
  return -Math.log(Math.max(eps, p));
}

function topPick(pred) {
  if (pred.win >= pred.draw && pred.win >= pred.lose) return 'home';
  if (pred.lose >= pred.draw && pred.lose >= pred.win) return 'away';
  return 'draw';
}

// 模型工厂：返回 { name, predict(match) -> {win,draw,lose} }
const models = [
  {
    name: 'Elo-Poisson (旧基线)',
    predict: (m) => {
      const eh = wc2022.teamsElo[m.h], ea = wc2022.teamsElo[m.a];
      // 2022 卡塔尔无东道主优势加成（只有 QAT），简化忽略
      return poissonPredict(eh, ea, 0);
    },
  },
  {
    name: 'Dixon-Coles',
    predict: (m) => {
      const sh = strengthFor(m.h, wc2022.teamsElo[m.h]);
      const sa = strengthFor(m.a, wc2022.teamsElo[m.a]);
      return predictDC({
        homeAttack: sh.attack, homeDefense: sh.defense,
        awayAttack: sa.attack, awayDefense: sa.defense,
        homeAdvantage: 1.0,
      });
    },
  },
  {
    name: 'Ensemble (Elo+DC+xG)',
    predict: (m) => {
      const home = { id: m.h, elo: wc2022.teamsElo[m.h] };
      const away = { id: m.a, elo: wc2022.teamsElo[m.a] };
      return predictEnsemble(home, away, { data, isHostMatch: false });
    },
  },
];

console.log('===== 2022 卡塔尔世界杯模型回测 =====');
console.log(`样本数: ${wc2022.matches.length} 场\n`);
console.log('模型                     | Brier↓  | LogLoss↓ | 准确率↑');
console.log('-'.repeat(64));

const results = [];
for (const model of models) {
  let totBrier = 0, totLog = 0, correct = 0;
  for (const m of wc2022.matches) {
    const pred = model.predict(m);
    const actual = actualOutcome(m);
    totBrier += brier(pred, actual);
    totLog += logLoss(pred, actual);
    if (topPick(pred) === actual) correct++;
  }
  const N = wc2022.matches.length;
  const row = {
    name: model.name,
    brier: totBrier / N,
    logLoss: totLog / N,
    acc: correct / N,
  };
  results.push(row);
  console.log(
    `${row.name.padEnd(24)} | ${row.brier.toFixed(4)}  | ${row.logLoss.toFixed(4)}   | ${(row.acc * 100).toFixed(1)}%`,
  );
}

console.log('\n参考：全随机猜 Brier ≈ 0.667，LogLoss ≈ 1.099，准确率 33%');
console.log('解读：Brier/LogLoss 越低越好，反映概率校准；准确率反映 Top-1 选对率。');

// 找出每个模型预测最离谱的 5 场（最大 Brier 贡献）
console.log('\n--- Ensemble 预测最差的 5 场（用于诊断）---');
const worst = [];
for (const m of wc2022.matches) {
  const home = { id: m.h, elo: wc2022.teamsElo[m.h] };
  const away = { id: m.a, elo: wc2022.teamsElo[m.a] };
  const pred = predictEnsemble(home, away, { data });
  const actual = actualOutcome(m);
  const b = brier(pred, actual);
  worst.push({ m, pred, actual, b });
}
worst.sort((x, y) => y.b - x.b);
for (const w of worst.slice(0, 5)) {
  const p = w.pred;
  console.log(
    `  ${w.m.h} ${w.m.hs}-${w.m.as} ${w.m.a}  实际:${w.actual.padEnd(4)} ` +
    `预测 H/D/A = ${(p.win*100).toFixed(0)}%/${(p.draw*100).toFixed(0)}%/${(p.lose*100).toFixed(0)}%  ` +
    `Brier=${w.b.toFixed(3)}`,
  );
}
