// ===== 蒙特卡洛淘汰赛模拟 =====
// 给定一个 predict() 输出（含 grid 比分概率），按累积分布抽样：
//   - 小组赛 / 90 分钟：直接抽一格 (h,a) 当结果
//   - 淘汰赛：若抽出平局，按 Elo 加权决定点球大战赢家
// 跑 N 次（默认 10000）即可估算"夺冠概率""进入半决赛概率"等全局分布。

/**
 * 从 grid 中按概率抽样一个比分
 */
export function sampleScore(grid) {
  const r = Math.random();
  let acc = 0;
  for (let h = 0; h < grid.length; h++) {
    for (let a = 0; a < grid[h].length; a++) {
      acc += grid[h][a];
      if (r <= acc) return { h, a };
    }
  }
  // 极少数浮点累计问题，兜底返回最后一格
  return { h: grid.length - 1, a: grid[0].length - 1 };
}

/**
 * 模拟一场淘汰赛（必须分胜负，平局走点球）
 * @param pred  ensemble/dc/poisson 任一模型的输出
 * @param eloHome / eloAway  用于平局时的点球加权
 * @returns { winner: 'home'|'away', score: {h,a}, viaPK: bool }
 */
export function simulateKO(pred, eloHome, eloAway) {
  const score = sampleScore(pred.grid);
  if (score.h > score.a) return { winner: 'home', score, viaPK: false };
  if (score.h < score.a) return { winner: 'away', score, viaPK: false };
  // 平局：点球大战，强队略占优（Elo 差 → 概率）
  const ea = 1 / (1 + Math.pow(10, (eloAway - eloHome) / 800)); // 点球差距更小，分母 800
  const win = Math.random() < ea;
  return { winner: win ? 'home' : 'away', score, viaPK: true };
}

/**
 * 跑 N 次蒙特卡洛得到统计分布
 * @param simulateOnce  () => { winner, ...}
 * @param N             默认 10000
 */
export function monteCarlo(simulateOnce, N = 10000) {
  const stats = { home: 0, away: 0, viaPK: 0 };
  for (let i = 0; i < N; i++) {
    const r = simulateOnce();
    stats[r.winner]++;
    if (r.viaPK) stats.viaPK++;
  }
  return {
    pHome: stats.home / N,
    pAway: stats.away / N,
    pPK: stats.viaPK / N,
    N,
  };
}
