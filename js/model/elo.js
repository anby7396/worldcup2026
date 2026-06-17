// ===== Elo 评分 + 预期胜率 =====
// 用两支球队的 Elo 分差估算主队获胜的"期望进球能力"。
// 这是足球数据分析里的经典组合：Elo 反映球队长期实力，
// 泊松分布则把"实力差距"翻译成"进球数的概率分布"。

// 标准 Elo 期望得分（0~1），主队视角
export function expectedScore(eloHome, eloAway, homeAdvantage = 0) {
  // homeAdvantage：主场加成。世界杯除东道主外均为中立场，默认 0；
  // 仅东道主比赛时由调用方传入加成（见 predictor 视图）。
  const ea = 1 / (1 + Math.pow(10, (eloAway - (eloHome + homeAdvantage)) / 400));
  return ea;
}

// 把 Elo 期望值映射成"预期进球数"。
// 基准：两队实力相当 → 各约 1.35 球（足球平均总进球 ~2.7）。
export function expectedGoals(eloHome, eloAway, homeAdvantage = 0) {
  const baseTotal = 2.7;          // 一场比赛的预期总进球
  const ea = expectedScore(eloHome, eloAway, homeAdvantage);
  // ea 是主队"得分占比"的代理（0~1）；用其对半分配主客预期进球
  const homeXG = baseTotal * (0.5 + (ea - 0.5)); // 强队略多
  const awayXG = baseTotal - homeXG;
  return {
    homeXG: Math.max(0.2, homeXG),
    awayXG: Math.max(0.2, awayXG),
  };
}

// 比赛结束后，按真实比分更新两队的 Elo（供"模拟淘汰赛晋级"等场景用）
export function updateElo(eloHome, eloAway, homeGoals, awayGoals, k = 24) {
  const ea = expectedScore(eloHome, eloAway);
  // 把比分换算成 0/0.5/1 的"实际得分"
  let sa;
  if (homeGoals > awayGoals) sa = 1;
  else if (homeGoals === awayGoals) sa = 0.5;
  else sa = 0;
  // 净胜球权重调整（大胜拿更多分）
  const goalDiff = Math.abs(homeGoals - awayGoals);
  const gdMult = goalDiff === 2 ? 1.5 : goalDiff >= 3 ? (11 + goalDiff) / 8 : 1;
  const delta = k * gdMult * (sa - ea);
  return {
    home: Math.round(eloHome + delta),
    away: Math.round(eloAway - delta),
  };
}
