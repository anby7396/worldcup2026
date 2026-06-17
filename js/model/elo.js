// ===== Elo 评分 + 预期胜率 =====
// Elo 是球队"长期实力"的标量代理。这里保留传统 Elo→xG 路径，
// 同时暴露 expectedScore 供其他模型（Dixon-Coles 集成）使用。

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
  // 用 sigmoid 形状的映射，避免极端 Elo 差出现负 xG
  const homeXG = baseTotal * (0.5 + (ea - 0.5));
  const awayXG = baseTotal - homeXG;
  return {
    homeXG: Math.max(0.2, homeXG),
    awayXG: Math.max(0.2, awayXG),
  };
}

// 比赛结束后，按真实比分更新两队的 Elo。
// k 默认 24（普通比赛），世界杯/欧洲杯调用方应传入更大的 k（45-60），
// 友谊赛传入更小的 k（10-15），符合 eloratings.net 校准方法。
export function updateElo(eloHome, eloAway, homeGoals, awayGoals, k = 24) {
  const ea = expectedScore(eloHome, eloAway);
  let sa;
  if (homeGoals > awayGoals) sa = 1;
  else if (homeGoals === awayGoals) sa = 0.5;
  else sa = 0;
  const goalDiff = Math.abs(homeGoals - awayGoals);
  const gdMult = goalDiff === 2 ? 1.5 : goalDiff >= 3 ? (11 + goalDiff) / 8 : 1;
  const delta = k * gdMult * (sa - ea);
  return {
    home: Math.round(eloHome + delta),
    away: Math.round(eloAway - delta),
  };
}

// 按赛事重要性返回校准后的 K 值
export function kForCompetition(comp) {
  // comp: 'friendly' | 'qualifier' | 'continental' | 'worldcup'
  switch (comp) {
    case 'friendly':    return 10;
    case 'qualifier':   return 30;
    case 'continental': return 45;
    case 'worldcup':    return 60;
    default:            return 24;
  }
}
