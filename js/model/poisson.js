// ===== 独立泊松模型（基线）=====
// 经典 Elo → xG → Poisson 三段式。保留为：
//   1) 集成模型中的一个"基线"成员（与 Dixon-Coles、xG 模型加权平均）
//   2) 老代码 / 简单场景的向后兼容入口
// 复杂场景请用 dixonColes.js 或 ensemble.js。

import { expectedGoals } from './elo.js';

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function poisson(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

const MAX = 7;

/**
 * 独立泊松预测（从 Elo 推 xG）
 * @returns { model, win, draw, lose, xg:{home,away}, top, grid, mostLikely }
 */
export function predict(eloHome, eloAway, homeAdvantage = 0) {
  const { homeXG, awayXG } = expectedGoals(eloHome, eloAway, homeAdvantage);
  return predictFromXG(homeXG, awayXG);
}

/**
 * 直接从给定 xG 预测（供其他模型/外部 xG 数据复用）
 */
export function predictFromXG(homeXG, awayXG) {
  const grid = [];
  let win = 0, draw = 0, lose = 0;
  const scorelines = [];

  for (let h = 0; h <= MAX; h++) {
    grid[h] = [];
    for (let a = 0; a <= MAX; a++) {
      const p = poisson(h, homeXG) * poisson(a, awayXG);
      grid[h][a] = p;
      if (h > a) win += p;
      else if (h === a) draw += p;
      else lose += p;
      scorelines.push({ h, a, p });
    }
  }

  const sum = win + draw + lose;
  win /= sum; draw /= sum; lose /= sum;
  for (let h = 0; h <= MAX; h++) for (let a = 0; a <= MAX; a++) grid[h][a] /= sum;
  scorelines.forEach(s => s.p /= sum);
  scorelines.sort((x, y) => y.p - x.p);

  return {
    model: 'poisson',
    xg: { home: homeXG, away: awayXG },
    win, draw, lose,
    top: scorelines.slice(0, 6),
    grid,
    mostLikely: scorelines[0],
  };
}

// 已弃用：旧的 simulateOutcome（淘汰赛用），新代码请用 monteCarlo.js
export function simulateOutcome(pred) {
  return pred.win >= pred.lose;
}
