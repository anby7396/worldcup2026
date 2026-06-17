// ===== 赔率 → 隐含概率模型 =====
// 核心任务：把 bookmaker 的 decimal odds 反推成"市场隐含概率"，
// 然后去掉 vigorish（庄家抽水 / overround），得到真实市场概率。
//
// 去除抽水的两种方法：
//   1. 简单归一化（multiplicative）：每个隐含概率 / 总overround
//      —— 简单但系统性高估热门、低估冷门
//   2. Shin method（1993）：基于"赌客偏好冷门"行为模型，更准
//      —— 实测在足球 h2h 上偏差最小，本项目默认用 Shin
//
// 多 bookmaker 融合：Pinnacle 单独取（sharp 线代表市场共识），
// 其余取中位数，避免单一软线干扰。

// decimal → 隐含概率（未去 vig）
export function impliedProb(decimalOdds) {
  if (!decimalOdds || decimalOdds <= 1) return 0;
  return 1 / decimalOdds;
}

// 简单归一化去 vig（适合 spreads/totals 这种 2 路）
export function normalize(impliedProbs) {
  const sum = impliedProbs.reduce((s, p) => s + p, 0);
  return sum > 0 ? impliedProbs.map(p => p / sum) : impliedProbs;
}

// Shin 方法去 vig（适合 h2h 三路）
// 论文：Shin (1993) "Measuring the Incidence of Insider Trading"
// 关键关系：π_i = sqrt(z²/4 + (1-z)·p_i²) + z/2
// 反解真实概率：p_i = sqrt(π_i·(π_i - z) / (1-z))
// 求 z 使 Σ p_i = 1（z > 0 表示有 overround/抽水）
// 实测在足球 h2h 上偏差最小，比简单归一化/multiplicative/additive 都准
export function shin(probs, iterations = 100) {
  const n = probs.length;
  // 二分求 z。z ∈ [0, max(π_i)·0.9]
  let lo = 0, hi = Math.min(...probs) * 0.9;
  const sumAt = (z) => {
    let s = 0;
    for (const pi of probs) s += Math.sqrt(Math.max(0, pi * (pi - z) / (1 - z)));
    return s;
  };
  // z=0 时 sumAt = Σπ > 1；z 越大 sumAt 越小
  for (let it = 0; it < iterations; it++) {
    const mid = (lo + hi) / 2;
    if (sumAt(mid) > 1) lo = mid; else hi = mid;
    if (hi - lo < 1e-12) break;
  }
  const z = (lo + hi) / 2;
  const out = probs.map(pi =>
    Math.sqrt(Math.max(0, pi * (pi - z) / (1 - z))),
  );
  // 兜底归一化（数值误差）
  const s = out.reduce((acc, p) => acc + p, 0);
  return out.map(p => p / s);
}

// 给定一场比赛的 bookmakers 字段（来自 odds.json），算出三市场的"市场共识概率"
// 返回：{ h2h: {home,draw,away}, totals: {over: {line, p}, under: {line, p}}, spreads: [...] }
export function marketConsensus(match) {
  const bms = match.bookmakers || {};
  const out = { h2h: null, spreads: [], totals: [] };

  // ---- h2h：每家 bookmaker 算 Shin 后取中位数 ----
  const h2hSamples = [];
  for (const [bmKey, bm] of Object.entries(bms)) {
    if (!bm.h2h || bm.h2h.length < 3) continue;
    // 按 home/draw/away 找到对应赔率
    const find = name => bm.h2h.find(o => o.name === name)?.price;
    const homeOdds = find(match.homeName) || bm.h2h[0]?.price;
    const drawOdds = find('Draw') || bm.h2h.find(o => o.name === 'Draw')?.price;
    const awayOdds = find(match.awayName) || bm.h2h[2]?.price;
    if (!homeOdds || !drawOdds || !awayOdds) continue;
    const probs = shin([impliedProb(homeOdds), impliedProb(drawOdds), impliedProb(awayOdds)]);
    h2hSamples.push({ home: probs[0], draw: probs[1], away: probs[2], source: bmKey });
  }
  if (h2hSamples.length > 0) {
    // Pinnacle 优先（sharp 线），否则中位数
    const pinnacle = h2hSamples.find(s => s.source === 'pinnacle');
    out.h2h = pinnacle || median3Way(h2hSamples);
  }

  // ---- spreads（亚洲让球）：每家 bookmaker 一组，按让球数分组取中位数 ----
  const spreadGroups = {};
  for (const [bmKey, bm] of Object.entries(bms)) {
    if (!bm.spreads) continue;
    for (const o of bm.spreads) {
      if (o.point === null || o.point === undefined) continue;
      const key = String(o.point);
      if (!spreadGroups[key]) spreadGroups[key] = { point: o.point, samples: [] };
      spreadGroups[key].samples.push({ name: o.name, price: o.price, source: bmKey });
    }
  }
  for (const g of Object.values(spreadGroups)) {
    // 每个 point 下应该有 home/away 两条，去 vig 后取中位数
    const home = g.samples.filter(s =>
      s.name === match.homeName || s.name === 'Home').map(s => s.price);
    const away = g.samples.filter(s =>
      s.name === match.awayName || s.name === 'Away').map(s => s.price);
    if (!home.length || !away.length) continue;
    const medH = median(home), medA = median(away);
    const [pH, pA] = normalize([impliedProb(medH), impliedProb(medA)]);
    out.spreads.push({ point: g.point, home: pH, away: pA, homeOdds: medH, awayOdds: medA });
  }

  // ---- totals（大小球）：按 line 分组 ----
  const totalGroups = {};
  for (const [bmKey, bm] of Object.entries(bms)) {
    if (!bm.totals) continue;
    for (const o of bm.totals) {
      if (o.point === null || o.point === undefined) continue;
      const key = String(o.point);
      if (!totalGroups[key]) totalGroups[key] = { point: o.point, samples: [] };
      totalGroups[key].samples.push({ name: o.name, price: o.price });
    }
  }
  for (const g of Object.values(totalGroups)) {
    const overs = g.samples.filter(s => s.name === 'Over').map(s => s.price);
    const unders = g.samples.filter(s => s.name === 'Under').map(s => s.price);
    if (!overs.length || !unders.length) continue;
    const medO = median(overs), medU = median(unders);
    const [pO, pU] = normalize([impliedProb(medO), impliedProb(medU)]);
    out.totals.push({ line: g.point, over: pO, under: pU, overOdds: medO, underOdds: medU });
  }

  return out;
}

// 取三路样本的中位数（每路独立排序取中位数）
function median3Way(samples) {
  const home = samples.map(s => s.home).sort((a, b) => a - b);
  const draw = samples.map(s => s.draw).sort((a, b) => a - b);
  const away = samples.map(s => s.away).sort((a, b) => a - b);
  return {
    home: medianSorted(home),
    draw: medianSorted(draw),
    away: medianSorted(away),
    source: 'median',
    n: samples.length,
  };
}

function median(arr) { return medianSorted([...arr].sort((a, b) => a - b)); }
function medianSorted(sorted) {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
