#!/usr/bin/env node
// ===== 用市场赔率校准 attack/defense 参数 =====
// 思路：市场 h2h 胜平负概率（Shin 去 vig 后）比手工 attack/defense 准。
// 用 Adam 梯度下降拟合每队的 attack/defense，最小化"模型胜平负 vs 市场胜平负"的交叉熵。
// 拟合后模型主线贴合市场，valuebet 只在市场盲区（具体比分、让球细节）出现真实 edge。
//
// 用法：node scripts/calibrate.mjs           # 拟合 + 打印对比，不写回
//       node scripts/calibrate.mjs --write   # 拟合 + 写回 data/worldcup2026.json

import { readFile, writeFile } from 'fs/promises';
import { marketConsensus } from '../js/model/odds.js';
import { predictDC } from '../js/model/dixonColes.js';

const WRITE = process.argv.includes('--write');

const data = JSON.parse(await readFile('data/worldcup2026.json', 'utf8'));
data.teamMap = Object.fromEntries(data.teams.map(t => [t.id, t]));
const odds = JSON.parse(await readFile('data/odds.json', 'utf8'));

// --- 1. 提取每场市场 h2h + totals 概率 ---
const samples = [];               // h2h 样本
const totalsSamples = [];         // totals 样本（取每场最主流的大球线）
for (const m of odds.matches) {
  const c = marketConsensus(m);
  if (!m.homeId || !m.awayId) continue;
  if (c.h2h) {
    samples.push({
      homeId: m.homeId, awayId: m.awayId,
      mHome: c.h2h.home, mDraw: c.h2h.draw, mAway: c.h2h.away,
    });
  }
  // totals：取 line=2.5 的（最主流），否则取第一个
  if (c.totals && c.totals.length) {
    const t = c.totals.find(x => Math.abs(x.line - 2.5) < 0.01) || c.totals[0];
    totalsSamples.push({
      homeId: m.homeId, awayId: m.awayId,
      line: t.line, mOver: t.over, mUnder: t.under,
    });
  }
}
console.log(`📊 参与校准：${samples.length} 场 h2h + ${totalsSamples.length} 场 totals`);

// 全局 leagueAvg 参数（初始 1.35）
let leagueAvg = 1.35;

// --- 2. 初始化 attack/defense（用现有 teamStrength，缺失用 1.0）---
const teamIds = [...new Set([...samples, ...totalsSamples].flatMap(s => [s.homeId, s.awayId]))];
const params = {};
for (const id of teamIds) {
  const s = data.teamStrength?.[id] || { attack: 1, defense: 1 };
  params[id] = { attack: s.attack, defense: s.defense };
}
console.log(`🏀 参与校准的球队：${teamIds.length} 队\n`);

// --- 3. forward：算 h2h + totals 的模型概率，联合交叉熵 loss ---
const EPS = 1e-9;
function forward() {
  let loss = 0;
  const h2hPreds = [];
  for (const s of samples) {
    const p = predictDC({
      homeAttack: params[s.homeId].attack, homeDefense: params[s.homeId].defense,
      awayAttack: params[s.awayId].attack, awayDefense: params[s.awayId].defense,
      homeAdvantage: 1.0, leagueAvg,
    });
    loss += -(s.mHome * Math.log(p.win + EPS) + s.mDraw * Math.log(p.draw + EPS) + s.mAway * Math.log(p.lose + EPS));
    h2hPreds.push({ win: p.win, draw: p.draw, lose: p.lose, grid: p.grid });
  }
  // totals：从 grid 算 P(total > line)
  const totalsPreds = [];
  for (const s of totalsSamples) {
    // 复用同一场的 grid（samples 与 totalsSamples 同序未必保证，重算）
    const p = predictDC({
      homeAttack: params[s.homeId].attack, homeDefense: params[s.homeId].defense,
      awayAttack: params[s.awayId].attack, awayDefense: params[s.awayId].defense,
      homeAdvantage: 1.0, leagueAvg,
    });
    let pOver = 0, pUnder = 0;
    for (let h = 0; h < p.grid.length; h++) {
      for (let a = 0; a < p.grid[h].length; a++) {
        const tot = h + a;
        if (tot > s.line) pOver += p.grid[h][a];
        else if (tot < s.line) pUnder += p.grid[h][a];
        else { pOver += p.grid[h][a] / 2; pUnder += p.grid[h][a] / 2; }
      }
    }
    loss += -(s.mOver * Math.log(pOver + EPS) + s.mUnder * Math.log(pUnder + EPS));
    totalsPreds.push({ pOver, pUnder });
  }
  return { loss, h2hPreds, totalsPreds };
}

// --- 4. 数值梯度（含全局 leagueAvg）---
const GRAD_EPS = 1e-5;
function gradient() {
  const { loss: base } = forward();
  const grad = {};
  for (const id of teamIds) {
    for (const k of ['attack', 'defense']) {
      const orig = params[id][k];
      params[id][k] = orig + GRAD_EPS;
      const lp = forward().loss;
      params[id][k] = orig;
      grad[id + '.' + k] = (lp - base) / GRAD_EPS;
    }
  }
  // leagueAvg 全局梯度
  const origLA = leagueAvg;
  leagueAvg = origLA + GRAD_EPS;
  const lpLA = forward().loss;
  leagueAvg = origLA;
  grad.__leagueAvg = (lpLA - base) / GRAD_EPS;
  return { base, grad };
}

// --- 5. 归一化：每轮把 attack/defense 各自除以均值，防止整体漂移 ---
function renormalize() {
  let sa = 0, sd = 0;
  for (const id of teamIds) { sa += params[id].attack; sd += params[id].defense; }
  const ma = sa / teamIds.length, md = sd / teamIds.length;
  for (const id of teamIds) { params[id].attack /= ma; params[id].defense /= md; }
}

// --- 6. Adam 优化 ---
const mAdam = {}, vAdam = {};
const B1 = 0.9, B2 = 0.999, LR = 0.03;
const ITERS = 400;
const LO_BOUND = 0.4, HI_BOUND = 2.0;

console.log('⚙️  开始 Adam 梯度下降（400 轮，含 leagueAvg）…');
const initLoss = forward().loss;
for (let it = 1; it <= ITERS; it++) {
  const { base, grad } = gradient();
  for (const key in grad) {
    mAdam[key] = (mAdam[key] || 0) * B1 + (1 - B1) * grad[key];
    vAdam[key] = (vAdam[key] || 0) * B2 + (1 - B2) * grad[key] * grad[key];
    const mh = mAdam[key] / (1 - Math.pow(B1, it));
    const vh = vAdam[key] / (1 - Math.pow(B2, it));
    if (key === '__leagueAvg') {
      leagueAvg -= LR * mh / (Math.sqrt(vh) + 1e-8);
      leagueAvg = Math.max(0.8, Math.min(2.0, leagueAvg));
    } else {
      const [id, k] = key.split('.');
      params[id][k] -= LR * mh / (Math.sqrt(vh) + 1e-8);
      params[id][k] = Math.max(LO_BOUND, Math.min(HI_BOUND, params[id][k]));
    }
  }
  renormalize();
  if (it % 50 === 0) console.log(`   iter ${it}: loss=${base.toFixed(3)} leagueAvg=${leagueAvg.toFixed(3)}`);
}
const finalLoss = forward().loss;
console.log(`\n📉 联合交叉熵 loss: ${initLoss.toFixed(3)} → ${finalLoss.toFixed(3)} (降 ${((1-finalLoss/initLoss)*100).toFixed(1)}%)`);
console.log(`📐 leagueAvg: 1.350 → ${leagueAvg.toFixed(3)}\n`);

// --- 7. 校准前后对比：h2h + totals Brier ---
function brierH2H(preds) {
  let s = 0;
  for (let i = 0; i < samples.length; i++) {
    const p = preds[i], m = samples[i];
    s += (p.win-m.mHome)**2 + (p.draw-m.mDraw)**2 + (p.lose-m.mAway)**2;
  }
  return s / samples.length;
}
function brierTotals(preds) {
  let s = 0;
  for (let i = 0; i < totalsSamples.length; i++) {
    const p = preds[i], m = totalsSamples[i];
    s += (p.pOver-m.mOver)**2 + (p.pUnder-m.mUnder)**2;
  }
  return s / totalsSamples.length;
}

// 校准前的 preds（用原始 teamStrength + leagueAvg=1.35）
const origParams = {};
for (const id of teamIds) {
  const s = data.teamStrength?.[id] || { attack: 1, defense: 1 };
  origParams[id] = { attack: s.attack, defense: s.defense };
}
const savedParams = JSON.parse(JSON.stringify(params));
const savedLA = leagueAvg;
Object.assign(params, JSON.parse(JSON.stringify(origParams)));
leagueAvg = 1.35;
const beforeF = forward();
Object.assign(params, savedParams);
leagueAvg = savedLA;
const afterF = forward();

console.log('=== 校准效果（模型 vs 市场的 Brier，越低越准）===');
console.log(`  h2h    校准前 ${brierH2H(beforeF.h2hPreds).toFixed(4)} → 校准后 ${brierH2H(afterF.h2hPreds).toFixed(4)}`);
console.log(`  totals 校准前 ${brierTotals(beforeF.totalsPreds).toFixed(4)} → 校准后 ${brierTotals(afterF.totalsPreds).toFixed(4)}`);
console.log(`  理想(=市场自比): 0.0000\n`);

// --- 8. 抽样几场看贴合度 ---
console.log('=== 抽样对比（校准后模型 vs 市场）===');
const showIdx = [0, Math.floor(samples.length/3), Math.floor(2*samples.length/3), samples.length-1];
for (const i of showIdx) {
  const s = samples[i], p = afterF.h2hPreds[i];
  const hn = data.teamMap[s.homeId]?.nameCn, an = data.teamMap[s.awayId]?.nameCn;
  console.log(`  ${hn} vs ${an}`);
  console.log(`    h2h 市场: ${(s.mHome*100).toFixed(0)}%/${(s.mDraw*100).toFixed(0)}%/${(s.mAway*100).toFixed(0)}%  模型: ${(p.win*100).toFixed(0)}%/${(p.draw*100).toFixed(0)}%/${(p.lose*100).toFixed(0)}%`);
  if (totalsSamples[i]) {
    const ts = totalsSamples[i], tp = afterF.totalsPreds[i];
    console.log(`    大${ts.line} 市场: ${(ts.mOver*100).toFixed(0)}%  模型: ${(tp.pOver*100).toFixed(0)}%`);
  }
}

// --- 9. 输出每队校准后参数 + 写回 ---
console.log('\n=== 校准后 attack/defense ===');
const rows = teamIds.map(id => ({
  id, name: data.teamMap[id]?.nameCn,
  a: params[id].attack, d: params[id].defense,
  oa: data.teamStrength?.[id]?.attack, od: data.teamStrength?.[id]?.defense,
})).sort((x,y) => (y.a+y.d)-(x.a+x.d));
for (const r of rows) {
  const dA = r.oa ? ` (原${r.oa.toFixed(2)})` : '';
  const dD = r.od ? ` (原${r.od.toFixed(2)})` : '';
  console.log(`  ${r.name.padEnd(8)} attack ${r.a.toFixed(2)}${dA}   defense ${r.d.toFixed(2)}${dD}`);
}

if (WRITE) {
  data.teamStrength = data.teamStrength || {};
  for (const id of teamIds) data.teamStrength[id] = { attack: +params[id].attack.toFixed(3), defense: +params[id].defense.toFixed(3) };
  data.meta = data.meta || {};
  data.meta.leagueAvg = +leagueAvg.toFixed(3);
  await writeFile('data/worldcup2026.json', JSON.stringify(data, null, 2));
  console.log(`\n✅ 已写回 data/worldcup2026.json（teamStrength + meta.leagueAvg=${leagueAvg.toFixed(3)}）`);
} else {
  console.log('\n💡 这是 dry-run。要写回：node scripts/calibrate.mjs --write');
}
