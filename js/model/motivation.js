// ===== 比赛动机因子 =====
// 小组赛不同阶段，球队的"全力程度"不同：
//   - 生死战（第一场输了）：超常发挥，λ × 1.05
//   - 正常比赛：λ × 1.0
//   - 已确定出线（第三轮 6+分）：轮换风险，λ × 0.92
//   - 已出局（第三轮 0-1 分）：没动力，λ × 0.88
//
// 动机因子乘到 predictEnsemble 的 λ_home / λ_away 上，
// 让模型在第二轮、第三轮小组赛的预测更贴近现实。
//
// 接口：getMotivationFactors(data) → { teamId: factor }
// data 需含 results（小组赛比分）和 groups/teamMap。

import { computeStandings } from '../data.js';

export function getMotivationFactors(data) {
  const factors = {};
  for (const group of Object.keys(data.groups)) {
    const st = computeStandings(data, group);
    for (const t of st) {
      factors[t.id] = computeFactor(t.p, t.pts, t.gd, t.gf);
    }
  }
  return factors;
}

/**
 * 根据已赛场次、积分、净胜球判断动机系数
 * @param {number} played  已赛场次（0/1/2/3）
 * @param {number} pts     积分
 * @param {number} gd      净胜球
 * @param {number} gf      进球数
 * @returns {number} 动机系数（0.85 ~ 1.05）
 */
function computeFactor(played, pts, gd, gf) {
  if (played <= 0) return 1.0;    // 未赛
  if (played >= 3) return 1.0;    // 小组赛结束

  if (played === 1) {
    // ---- 第二轮前（第一轮刚踢完）----
    if (pts === 0) return 1.05;   // 第一场输了，第二场生死战
    // 1 分（平局）或 3 分（赢了）：正常动机，第二场结果很重要但不绝望
    return 1.00;
  }

  if (played === 2) {
    // ---- 第三轮前（最关键，动机分化最大）----
    if (pts >= 6) {
      // 2 胜 = 6 分：几乎确定出线（世界杯历史上 6 分队出线率 >99%）
      // 争第一 vs 轮换取决于净胜球和对手，给 0.92（轮换风险）
      return 0.92;
    }
    if (pts === 4) {
      // 1 胜 1 平 = 4 分：大概率出线，正常动机
      return 1.00;
    }
    if (pts === 3) {
      // 1 胜 1 负 = 3 分：需要第三场拿分（至少平局），动力较高
      return 1.03;
    }
    if (pts === 2) {
      // 2 平 = 2 分：需要赢，压力大，动力拉满
      return 1.05;
    }
    // 0-1 分：几乎出局（世界杯历史上 0-1 分队第三轮出线率 <5%）
    // 球员知道没希望了，动力下降
    return 0.88;
  }

  return 1.0;
}

/**
 * 获取某场比赛双方的动机因子
 * @param {object} data   完整数据（含 results, groups）
 * @param {string} homeId 主队 ID
 * @param {string} awayId 客队 ID
 * @returns {{ home: number, away: number }}
 */
export function matchMotivation(data, homeId, awayId) {
  const factors = getMotivationFactors(data);
  return {
    home: factors[homeId] || 1.0,
    away: factors[awayId] || 1.0,
  };
}
