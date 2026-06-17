// 验证脚本：检查预测引擎数学 + 数据层逻辑的正确性
// node 无 localStorage，mock 一下（浏览器里是真实 API）
globalThis.localStorage = {
  _s: {},
  getItem(k) { return this._s[k] ?? null; },
  setItem(k, v) { this._s[k] = String(v); },
  removeItem(k) { delete this._s[k]; },
};
import { predict } from '../js/model/poisson.js';
import { expectedScore, updateElo } from '../js/model/elo.js';
import { groupFixtures, computeStandings, groupMatchKey, getGroupResult, setGroupResult } from '../js/data.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { cond ? (pass++, console.log('  ✅', msg)) : (fail++, console.log('  ❌', msg)); };

console.log('\n=== 1. Elo 期望得分（中立场，默认0加成）===');
const ea = expectedScore(2000, 1800);
ok(ea > 0.72 && ea < 0.80, `强队(2000)对弱队(1800)期望得分 ${(ea*100).toFixed(1)}% 在 72-80% 区间`);
const eb = expectedScore(1800, 1800);
ok(Math.abs(eb - 0.5) < 0.001, `同分中立场期望得分 ${(eb*100).toFixed(1)}% ≈ 50%`);
const ec = expectedScore(1800, 1800, 100);
ok(ec > 0.64, `同分但主队是东道主(+100) ${(ec*100).toFixed(1)}% > 64%，主场优势生效`);

console.log('\n=== 2. Elo 更新 ===');
const up = updateElo(1800, 1800, 2, 0);
ok(up.home > 1800 && up.away < 1800, `赢家 Elo 升至 ${up.home}，输家降至 ${up.away}`);

console.log('\n=== 3. 泊松预测：强 vs 弱 ===');
const p1 = predict(2120, 1600); // 西班牙 vs 海地级
ok(p1.win > 0.85, `超级强队胜率 ${(p1.win*100).toFixed(1)}% > 85%`);
ok(p1.xg.home > p1.xg.away, `强队预期进球 ${p1.xg.home.toFixed(2)} > 弱队 ${p1.xg.away.toFixed(2)}`);
ok(p1.mostLikely && p1.mostLikely.h >= p1.mostLikely.a, `最可能比分 ${p1.mostLikely.h}-${p1.mostLikely.a} 主队进球更多`);
const totalProb = p1.win + p1.draw + p1.lose;
ok(Math.abs(totalProb - 1) < 0.01, `胜平负概率之和 ${(totalProb*100).toFixed(1)}% ≈ 100%`);

console.log('\n=== 4. 泊松预测：势均力敌（中立场）===');
const p2 = predict(2010, 2010); // 英格兰 vs 荷兰级
ok(Math.abs(p2.win - p2.lose) < 0.001, `同实力中立场胜率完全相等：主${(p2.win*100).toFixed(1)}% 客${(p2.lose*100).toFixed(1)}%`);
ok(p2.draw > 0.2 && p2.draw < 0.35, `平局率 ${(p2.draw*100).toFixed(1)}% 在 20-35% 合理区间（足球常见）`);

console.log('\n=== 5. 数据层：赛程生成 ===');
const fx = groupFixtures('A', ['MEX','RSA','KOR','CZE']);
ok(fx.length === 6, `4队单循环生成 ${fx.length} 场（应为 6）`);
ok(fx.every(f => f.key.startsWith('G:A:')), '所有比赛 key 含组前缀');

console.log('\n=== 6. 数据层：积分榜计算 ===');
const results = {};
const key = groupMatchKey('A','MEX','RSA');
setGroupResult(results, key, 'MEX','RSA', 2, 0); // 墨西哥 2-0 南非
const st = computeStandings({ groups:{A:['MEX','RSA','KOR','CZE']}, teamMap:{
  MEX:{id:'MEX',nameCn:'墨',flag:'',elo:1}, RSA:{id:'RSA',nameCn:'南',flag:'',elo:1},
  KOR:{id:'KOR',nameCn:'韩',flag:'',elo:1}, CZE:{id:'CZE',nameCn:'捷',flag:'',elo:1},
}, results }, 'A');
const mex = st.find(t => t.id === 'MEX');
ok(mex.pts === 3 && mex.w === 1 && mex.gf === 2 && mex.ga === 0, `墨西哥积分${mex.pts} 胜${mex.w} 进${mex.gf} 失${mex.ga} 正确`);
ok(st[0].id === 'MEX', '墨西哥因赢球排第一');

console.log(`\n总计: ${pass} 通过, ${fail} 失败\n`);
process.exit(fail ? 1 : 0);
