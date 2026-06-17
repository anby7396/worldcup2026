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
};

/**
 * 找出一场比赛的所有正期望价值投注
 * @param {object} match   来自 odds.json 的比赛（含 bookmakers）
 * @param {object} pred    集成模型对该场的预测（含 win/draw/lose/grid/xg）
 * @param {object} opts    { bankroll, kellyFraction, maxStakePct, minEdge }
 * @returns { bets: [...], summary }
 */
export function findValueBets(match, pred, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const bankroll = cfg.bankroll || 1000;
  const consensus = marketConsensus(match);
  const bets = [];

  // --- 1. h2h 三路（胜平负）---
  if (consensus.h2h) {
    const candidates = [
      { name: `${match.homeName} 胜`, marketP: consensus.h2h.home, modelP: pred.win,
        marketOdds: 1 / consensus.h2h.home },
      { name: `平局`, marketP: consensus.h2h.draw, modelP: pred.draw,
        marketOdds: 1 / consensus.h2h.draw },
      { name: `${match.awayName} 胜`, marketP: consensus.h2h.away, modelP: pred.lose,
        marketOdds: 1 / consensus.h2h.away },
    ];
    for (const c of candidates) {
      const bet = evaluate(c.name, c.marketP, c.modelP, c.marketOdds, bankroll, cfg, 'h2h');
      if (bet) bets.push(bet);
    }
  }

  // --- 2. totals 大小球（从模型 grid 算 P(总进球 > line)）---
  for (const t of consensus.totals) {
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

    const homeBet = evaluate(`${match.homeName} 让 ${s.point}`, s.home, pHome, s.homeOdds, bankroll, cfg, 'spreads', { point: s.point });
    const awayBet = evaluate(`${match.awayName} 让 ${-s.point}`, s.away, pAway, s.awayOdds, bankroll, cfg, 'spreads', { point: -s.point });
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
    match: { homeName: match.homeName, awayName: match.awayName,
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
