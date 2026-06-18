// ===== 价值投注识别 + Kelly 仓位 =====
// 价值投注核心：
//   edge = p_model / p_implied - 1
//   edge > 0  → 模型认为该结果发生概率高于市场隐含 → 正期望值
//
// Kelly 公式（金融/博彩界标准）：
//   f* = (b*p - q) / b
//   b = decimal_odds - 1  （净赔率）
//   p = 模型概率
//   q = 1 - p
//   f* = 占总资金的最优下注比例
//
// 实战考虑：
//   1. 完整 Kelly 对概率估计误差极敏感，业界默认用分数 Kelly（1/4 或 1/2）
//   2. 单注仓位上限 5%（钳制），避免极端 Kelly
//   3. 同一场比赛多个候选 bet 时，按 Kelly 排序输出
//   4. edge 阈值：默认 ≥ 3% 才推荐（过滤噪声 + 留出 bookmaker 抽水缓冲）

import { marketConsensus } from './odds.js';

const DEFAULTS = {
  kellyFraction: 0.25,   // 1/4 Kelly
  maxStakePct: 0.05,     // 单注最多 5% bankroll
  minEdge: 0.03,         // 最小 edge 3%
  maxOdds: 15,           // 最大赔率 15（概率 >6.7%），过滤极端薄市场
};

/**
 * 找出一场比赛的所有正期望价值投注
 * @param {object} match   来自 odds.json / odds-jingcai.json 的比赛
 * @param {object} pred    集成模型对该场的预测（含 win/draw/lose/grid/xg）
 * @param {object} opts    { bankroll, kellyFraction, maxStakePct, minEdge, maxOdds }
 * @param {object} consensusOverride  可选，传入已算好的 consensus（竞彩模式用 jingcaiToConsensus）
 * @returns { bets: [...], summary }
 */
export function findValueBets(match, pred, opts = {}, consensusOverride = null) {
  const cfg = { ...DEFAULTS, ...opts };
  const bankroll = cfg.bankroll || 1000;
  const consensus = consensusOverride || marketConsensus(match);
  const bets = [];
  // 显示用队名：优先中文（由视图传入 homeNameCn/awayNameCn），回退到 API 英文名
  const hn = match.homeNameCn || match.homeName;
  const an = match.awayNameCn || match.awayName;

  // --- 1. h2h 三路（胜平负）---
  if (consensus.h2h) {
    const candidates = [
      { name: `${hn} 胜`, marketP: consensus.h2h.home, modelP: pred.win,
        marketOdds: 1 / consensus.h2h.home },
      { name: `平局`, marketP: consensus.h2h.draw, modelP: pred.draw,
        marketOdds: 1 / consensus.h2h.draw },
      { name: `${an} 胜`, marketP: consensus.h2h.away, modelP: pred.lose,
        marketOdds: 1 / consensus.h2h.away },
    ];
    for (const c of candidates) {
      const bet = evaluate(c.name, c.marketP, c.modelP, c.marketOdds, bankroll, cfg, 'h2h');
      if (bet) bets.push(bet);
    }
  }

  // --- 2. totals 大小球（从模型 grid 算 P(总进球 > line)）---
  // 竞彩用 ttg（独立进球数）代替 totals，此部分跳过
  for (const t of (consensus.totals || [])) {
    // 模型里总进球数 > line 的概率
    let pOver = 0, pUnder = 0;
    for (let h = 0; h < pred.grid.length; h++) {
      for (let a = 0; a < pred.grid[h].length; a++) {
        const total = h + a;
        if (total > t.line) pOver += pred.grid[h][a];
        else if (total < t.line) pUnder += pred.grid[h][a];
        // 等于 line 的情况按半算（实际菠菜 push 退本金）
        else { pOver += pred.grid[h][a] / 2; pUnder += pred.grid[h][a] / 2; }
      }
    }
    const overBet = evaluate(`大球 ${t.line}`, t.over, pOver, t.overOdds, bankroll, cfg, 'totals', { line: t.line });
    const underBet = evaluate(`小球 ${t.line}`, t.under, pUnder, t.underOdds, bankroll, cfg, 'totals', { line: t.line });
    if (overBet) bets.push(overBet);
    if (underBet) bets.push(underBet);
  }

  // --- 3. spreads 让球（重算模型在让球下的胜率）---
  for (const s of consensus.spreads) {
    // point > 0 表示主队让客队 |point| 球（或 +0.5/+1 这种亚洲盘）
    // 模型需要：P(homeGoals - awayGoals > point) / ==point / < point
    let pHome = 0, pAway = 0, pPush = 0;
    for (let h = 0; h < pred.grid.length; h++) {
      for (let a = 0; a < pred.grid[h].length; a++) {
        const diff = h - a - s.point;     // 主队让 point 后的净胜球
        if (diff > 0.001) pHome += pred.grid[h][a];
        else if (diff < -0.001) pAway += pred.grid[h][a];
        else pPush += pred.grid[h][a];
      }
    }
    // push 概率按 0.5 平分（实际退本金，简化处理）
    pHome += pPush / 2; pAway += pPush / 2;

    const homeBet = evaluate(`${hn} 让 ${s.point}`, s.home, pHome, s.homeOdds, bankroll, cfg, 'spreads', { point: s.point });
    const awayBet = evaluate(`${an} 让 ${-s.point}`, s.away, pAway, s.awayOdds, bankroll, cfg, 'spreads', { point: -s.point });
    if (homeBet) bets.push(homeBet);
    if (awayBet) bets.push(awayBet);
  }

  // 按 edge 排序
  bets.sort((a, b) => b.edge - a.edge);

  // 汇总：总建议下注额、加权预期回报
  const totalStake = bets.reduce((s, b) => s + b.stake, 0);
  const expectedReturn = bets.reduce((s, b) => s + b.expectedValue, 0);
  const roi = totalStake > 0 ? expectedReturn / totalStake : 0;

  return {
    match: { homeName: hn, awayName: an,
             homeNameEn: match.homeName, awayNameEn: match.awayName,
             homeId: match.homeId, awayId: match.awayId,
             commenceTime: match.commenceTime },
    bets,
    summary: {
      betCount: bets.length,
      totalStake,
      expectedReturn,
      roi,                       // 这一组的预期 ROI
      consensus,                 // 调试用：市场共识
    },
  };
}

// 评估单条 bet
function evaluate(name, marketP, modelP, marketOdds, bankroll, cfg, market, extra = {}) {
  // 防御
  if (!marketP || !modelP || marketP <= 0 || modelP <= 0) return null;
  if (!marketOdds || marketOdds <= 1) return null;
  // 极端赔率过滤：高赔率 = 薄市场 + 高 variance + 模型小误差被 edge 公式放大
  if (cfg.maxOdds && marketOdds > cfg.maxOdds) return null;

  const edge = modelP / marketP - 1;
  if (edge < cfg.minEdge) return null;

  // Kelly: f* = (b*p - q) / b, b = odds - 1
  const b = marketOdds - 1;
  const p = modelP;
  const q = 1 - p;
  let kelly = (b * p - q) / b;
  if (kelly <= 0) return null;
  kelly *= cfg.kellyFraction;
  kelly = Math.min(kelly, cfg.maxStakePct);   // 单注上限
  const stake = Math.max(1, Math.round(bankroll * kelly));

  // 预期收益（按模型概率）
  const expectedValue = stake * (p * b - q);   // 净期望
  const expectedReturn = stake + expectedValue;

  // 风险评级（基于模型概率 + edge）
  let risk;
  if (modelP >= 0.55) risk = 'low';
  else if (modelP >= 0.35) risk = 'medium';
  else risk = 'high';

  return {
    name, market, ...extra,
    marketP, modelP, marketOdds,
    edge,                    // 模型优势，e.g. 0.05 = +5%
    edgePct: (edge * 100).toFixed(1) + '%',
    kellyFraction: cfg.kellyFraction,
    kellyRaw: kelly / cfg.kellyFraction,   // 没打折前的 Kelly
    stake,                   // 建议下注额（元）
    stakePct: kelly,         // 占 bankroll 比例
    expectedValue,           // 期望净收益
    expectedReturn,          // 期望总返还
    risk,
  };
}

export { DEFAULTS };

// ===== 日预算约束下的资金分配 =====
// 小额日预算（如 20 元）下，纯 Kelly 单注仓位太小（¥1-2，低于最小下注额）。
// 改成在"日预算"上按策略分配，让每注达到可下注的金额。
//
// 三种策略：
//   proportional — 按 Kelly 相对权重分配，分散到多个高价值投注（单注上限 50%）
//   concentrated — 全部押 edge 最高的一注（高回报高波动）
//   fixed       — 每注固定金额，按 edge 从高到低投到预算用完
//
// @param bets   findValueBets 收集的所有候选（用其 edge / kellyRaw 字段）
// @param budget 日预算（如 20）
// @param strategy 'proportional' | 'concentrated' | 'fixed'
export function allocateBudget(bets, budget, strategy = 'proportional', opts = {}) {
  if (!bets.length || budget <= 0) return [];
  const sorted = [...bets].sort((a, b) => b.edge - a.edge);
  const perBet = opts.perBet || 5;
  const maxBets = opts.maxBets || 6;
  const cap = opts.cap || 0.5;

  if (strategy === 'concentrated') {
    const top = sorted[0];
    return [{ ...top, stake: budget, stakePct: 1, strategy }];
  }

  if (strategy === 'fixed') {
    let remaining = budget;
    const out = [];
    for (const b of sorted) {
      if (remaining < perBet) break;
      out.push({ ...b, stake: perBet, stakePct: perBet / budget, strategy });
      remaining -= perBet;
    }
    return out;
  }

  // proportional：取 top N，按 kellyRaw 归一化分配，单注 cap 上限
  const top = sorted.slice(0, maxBets);
  const minBet = opts.minBet || 2;          // 最小下注额，低于此不投（菠菜实务）
  const totalK = top.reduce((s, b) => s + Math.max(0, b.kellyRaw || 0), 0);
  const out = [];
  let used = 0;
  for (const b of top) {
    const k = Math.max(0, b.kellyRaw || 0);
    let stake = totalK > 0 ? budget * (k / totalK) : budget / top.length;
    stake = Math.min(stake, budget * cap);
    stake = Math.round(stake);
    if (stake < minBet) continue;            // 太小不投，预算留给其他注
    if (used + stake > budget) stake = budget - used;
    if (stake < minBet) break;
    out.push({ ...b, stake, stakePct: stake / budget, strategy });
    used += stake;
  }
  return out;
}

// ===== 竞彩专属价值识别：比分盘 (crs) + 总进球盘 (ttg) =====
// 这是 the-odds-api 不提供的核心能力：模型 grid 逐格 vs 竞彩赔率。

/**
 * 比分盘价值：模型 grid[h][a] vs 竞彩 crs 赔率隐含概率
 * @param {object} match  竞彩 match（有 homeNameCn/homeName）
 * @param {object} pred   模型预测（有 grid）
 * @param {object} consensus  jingcaiToConsensus 输出（有 crs 字段）
 */
export function findCRSValueBets(match, pred, consensus, opts = {}) {
  if (!consensus.crs) return [];
  const cfg = { ...DEFAULTS, ...opts };
  const bankroll = cfg.bankroll || 1000;
  const bets = [];
  const hn = match.homeNameCn || match.homeName;
  const an = match.awayNameCn || match.awayName;

  for (const [score, { odds, impliedProb: marketP }] of Object.entries(consensus.crs)) {
    const [h, a] = score.split('-').map(Number);
    if (!pred.grid[h] || !pred.grid[h][a]) continue;
    const modelP = pred.grid[h][a];
    const b = odds - 1, p = modelP, q = 1 - p;
    const edge = p / marketP - 1;
    if (edge < (cfg.minEdge || 0)) continue;
    if (cfg.maxOdds && odds > cfg.maxOdds) continue;
    let kelly = (b * p - q) / b;
    const kellyPositive = kelly > 0;
    kelly *= cfg.kellyFraction;
    kelly = Math.max(0, Math.min(kelly, cfg.maxStakePct));
    const kellyRaw = kellyPositive ? kelly / cfg.kellyFraction : 0;
    const stake = kellyPositive ? Math.max(1, Math.round(bankroll * kelly)) : 0;
    const ev = stake * (p * b - q);
    // CRS 风险：比分盘 modelP 天然小，阈值比通用低
    const risk = modelP >= 0.12 ? 'low' : modelP >= 0.06 ? 'medium' : 'high';
    bets.push({
      name: `${hn} ${score} ${an}`, market: 'crs', score,
      marketP, modelP, marketOdds: odds,
      edge, edgePct: (edge * 100).toFixed(1) + '%',
      kellyFraction: cfg.kellyFraction, kellyRaw, kellyPositive,
      stake, stakePct: stake > 0 ? stake / bankroll : 0,
      expectedValue: ev, expectedReturn: stake + ev, risk,
    });
  }
  return bets.sort((x, y) => y.edge - x.edge);
}

/**
 * 总进球盘价值：模型 P(总进球=k) vs 竞彩 ttg 赔率隐含概率
 */
export function findTTGValueBets(match, pred, consensus, opts = {}) {
  if (!consensus.ttg) return [];
  const cfg = { ...DEFAULTS, ...opts };
  const bankroll = cfg.bankroll || 1000;
  const bets = [];

  // 模型：总进球分布 P(total=k) = Σ_{h+a=k} grid[h][a]
  const totalProb = {};
  for (let h = 0; h < pred.grid.length; h++) {
    for (let a = 0; a < pred.grid[h].length; a++) {
      const k = String(h + a);
      totalProb[k] = (totalProb[k] || 0) + pred.grid[h][a];
    }
  }

  for (const [goals, { odds, impliedProb: marketP }] of Object.entries(consensus.ttg)) {
    const modelP = totalProb[goals] || 0;
    const b = odds - 1, p = modelP, q = 1 - p;
    const edge = p / marketP - 1;
    if (edge < (cfg.minEdge || 0)) continue;
    if (cfg.maxOdds && odds > cfg.maxOdds) continue;
    let kelly = (b * p - q) / b;
    const kellyPositive = kelly > 0;
    kelly *= cfg.kellyFraction;
    kelly = Math.max(0, Math.min(kelly, cfg.maxStakePct));
    const kellyRaw = kellyPositive ? kelly / cfg.kellyFraction : 0;
    const stake = kellyPositive ? Math.max(1, Math.round(bankroll * kelly)) : 0;
    const ev = stake * (p * b - q);
    // TTG 风险：总进球 2-3 球概率高，0/7 球概率低
    const risk = modelP >= 0.25 ? 'low' : modelP >= 0.15 ? 'medium' : 'high';
    bets.push({
      name: `总进 ${goals} 球`, market: 'ttg', goals,
      marketP, modelP, marketOdds: odds,
      edge, edgePct: (edge * 100).toFixed(1) + '%',
      kellyFraction: cfg.kellyFraction, kellyRaw, kellyPositive,
      stake, stakePct: stake > 0 ? stake / bankroll : 0,
      expectedValue: ev, expectedReturn: stake + ev, risk,
    });
  }
  return bets.sort((x, y) => y.edge - x.edge);
}
