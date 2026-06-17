// ===== 泊松模型：从预期进球数 → 比分概率分布 =====
// 核心：泊松分布描述"单位时间内随机事件发生次数"，
// 非常适合足球进球。已知两队预期进球数 λh、λa，
// 即可算出任意比分 (h-a) 的概率：P(h)×P(a)。

import { expectedGoals } from './elo.js';

function factorial(n) {
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

// 单队进 k 球的概率
function poisson(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

const MAX = 6; // 计算到 6 球，足够覆盖绝大多数情况

/**
 * 完整预测一场比赛
 * @returns { win, draw, lose, xg:{home,away}, top, grid, mostLikely }
 */
export function predict(eloHome, eloAway, homeAdvantage = 0) {
  const { homeXG, awayXG } = expectedGoals(eloHome, eloAway, homeAdvantage);

  // 构建比分概率矩阵 grid[h][a]
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

  // 归一化（截断 MAX 会导致三者之和略小于 1）
  const sum = win + draw + lose;
  win /= sum; draw /= sum; lose /= sum;

  scorelines.sort((x, y) => y.p - x.p);
  const top = scorelines.slice(0, 6).map(s => ({ ...s, p: s.p / sum }));

  return {
    xg: { home: homeXG, away: awayXG },
    win, draw, lose,
    top,
    grid,
    mostLikely: top[0],
  };
}

// 模拟一场比赛结果（用于淘汰赛推进），返回 0/1 主队是否晋级，平局时按概率随机
export function simulateOutcome(pred) {
  // 用累积分布 + Math.random 选比分；淘汰赛无平局，平局时用胜率加权重抽
  // 但这里淘汰赛阶段我们用"最可能胜方"简化（在 app 层用）
  return pred.win >= pred.lose;
}
