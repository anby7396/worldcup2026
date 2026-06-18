// ===== 集成预测模型 =====
// 把三个模型的概率加权平均：
//   A. Elo-Poisson（基线，靠长期实力）
//   B. Dixon-Coles（双参数 + 低比分修正，靠攻防系数）
//   C. xG-based 独立泊松（直接用 attack/defense 系数当 xG 代理）
//
// 集成的好处：单一模型在某些场景偏差大（A 在高低实力悬殊时高估强队、
// B 在数据不足的弱队上不稳），加权平均能稳定 1-3% 的 Brier score。
// 权重默认 A:B:C = 0.25 : 0.50 : 0.25，可在回测里调。

import { predict as poissonPredict, predictFromXG } from './poisson.js';
import { predictDC, altitudeAdjust } from './dixonColes.js';

const DEFAULT_WEIGHTS = { elo: 0.25, dc: 0.50, xg: 0.25 };

/**
 * 主集成入口
 * @param {object} home / away — 来自 data.teamMap[id] 的球队对象
 * @param {object} opts
 *   data         — 完整 data（用于查 teamStrength / venues）
 *   venue        — 比赛地点名（用于海拔修正），可选
 *   isHostMatch  — 主队是否在自己国家踢，决定是否给主场加成
 *   keyOut       — { home: 'attack'|'defense'|null, away: ... }
 *   weights      — 自定义权重 { elo, dc, xg }
 *   motivation   — { home: number, away: number } 动机因子（0.88~1.05），乘到 λ 上
 */
export function predictEnsemble(home, away, opts = {}) {
  const {
    data,
    venue = null,
    isHostMatch = false,
    keyOut = { home: null, away: null },
    weights = DEFAULT_WEIGHTS,
    motivation = { home: 1, away: 1 },
  } = opts;

  // --- 准备 attack/defense（缺省从 Elo 推） ---
  const strength = data?.teamStrength || {};
  const hs = strength[home.id] || eloToStrength(home.elo);
  const as_ = strength[away.id] || eloToStrength(away.elo);

  // --- 海拔修正 ---
  let altAdj = { home: 1, away: 1 };
  if (venue && data?.venues?.[venue]) {
    const venueAlt = data.venues[venue].altitude;
    // 简化：用球队代表性海拔（墨西哥 2240、玻利维亚 3640、其他 ≈ 200）
    const homeAlt = home.id === 'MEX' ? 2240 : 200;
    const awayAlt = away.id === 'MEX' ? 2240 : 200;
    altAdj = altitudeAdjust(venueAlt, homeAlt, awayAlt);
  }

  const homeAdvElo = isHostMatch ? 100 : 0;
  const homeAdvDC  = isHostMatch ? 1.25 : 1.0;

  // 校准后的总进球基准（默认 1.35，可由 scripts/calibrate.mjs 写到 meta.leagueAvg）
  const leagueAvg = data?.meta?.leagueAvg || 1.35;

  // --- A. Elo-Poisson ---
  const predA = poissonPredict(home.elo, away.elo, homeAdvElo);

  // --- B. Dixon-Coles 双参数（motivation 直接乘到 λ）---
  const predB = predictDC({
    homeAttack: hs.attack, homeDefense: hs.defense,
    awayAttack: as_.attack, awayDefense: as_.defense,
    homeAdvantage: homeAdvDC,
    altitudeAdj: altAdj,
    keyOut,
    leagueAvg,
    motivation,  // {home, away} 动机因子，乘到 λ_home/λ_away
  });

  // --- C. 纯 xG 独立泊松（用 attack/defense 直接算 λ，motivation 直接乘）---
  const lambdaHC = leagueAvg * hs.attack / as_.defense * homeAdvDC * altAdj.home * motivation.home;
  const lambdaAC = leagueAvg * as_.attack / hs.defense / Math.sqrt(homeAdvDC) * altAdj.away * motivation.away;
  const predC = predictFromXG(
    Math.max(0.15, Math.min(5.5, lambdaHC)),
    Math.max(0.15, Math.min(5.5, lambdaAC)),
  );

  // --- 加权平均概率 + 加权平均 grid ---
  const w = weights;
  const wSum = w.elo + w.dc + w.xg;
  const wA = w.elo / wSum, wB = w.dc / wSum, wC = w.xg / wSum;

  const win  = wA * predA.win  + wB * predB.win  + wC * predC.win;
  const draw = wA * predA.draw + wB * predB.draw + wC * predC.draw;
  const lose = wA * predA.lose + wB * predB.lose + wC * predC.lose;

  const MAX = predA.grid.length;
  const grid = [];
  const flat = [];
  for (let h = 0; h < MAX; h++) {
    grid[h] = [];
    for (let a = 0; a < MAX; a++) {
      const p = wA * predA.grid[h][a] + wB * predB.grid[h][a] + wC * predC.grid[h][a];
      grid[h][a] = p;
      flat.push({ h, a, p });
    }
  }
  flat.sort((x, y) => y.p - x.p);

  const xgHome = wA * predA.xg.home + wB * predB.xg.home + wC * predC.xg.home;
  const xgAway = wA * predA.xg.away + wB * predB.xg.away + wC * predC.xg.away;

  return {
    model: 'ensemble',
    members: { elo: predA, dc: predB, xg: predC },
    weights: { elo: wA, dc: wB, xg: wC },
    xg: { home: xgHome, away: xgAway },
    win, draw, lose,
    top: flat.slice(0, 6),
    grid,
    mostLikely: flat[0],
  };
}

// Elo 缺省 → attack/defense 估计（线性映射，2000 Elo ≈ 平均）
function eloToStrength(elo) {
  const k = (elo - 1700) / 400;     // 1700 → 0, 2100 → 1
  const attack = 0.9 + 0.5 * k;
  const defense = 0.9 + 0.5 * k;
  return {
    attack: Math.max(0.6, Math.min(1.6, attack)),
    defense: Math.max(0.6, Math.min(1.6, defense)),
  };
}

export { DEFAULT_WEIGHTS };
