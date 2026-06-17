#!/usr/bin/env node
// ===== 2026 世界杯比分同步脚本 =====
// 数据源：ESPN 非官方 API（无需 key、无需注册）
// 用法：node sync.mjs   ——  拉取小组赛已完赛比分 + 全部淘汰赛对阵，写入 data/results.json
//       网页打开时自动读取该文件，赛程/积分榜/对阵图随之更新。
import { readFile, writeFile } from 'fs/promises';

const ESPN_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard' +
  '?dates=20260611-20260719&limit=200';
const DATA_FILE = 'data/worldcup2026.json';
const OUT_FILE = 'data/results.json';

// 根据球队占位符判断它来自哪一轮的输出（用于推断该场比赛属于哪一轮）
// R32 的球队是小组出线队(1A/2B/3RD)；R16 的球队是 R32 胜者(RD32)；以此类推
function slotRound(abbr) {
  if (!abbr) return 0;
  if (/^SF\s*L\d/.test(abbr)) return 6;       // 半决赛败者 → 出现在季军赛
  if (/^SFW/.test(abbr)) return 5;            // 半决赛胜者 → 出现在决赛
  if (/^QF[W]?\d/.test(abbr)) return 4;       // 1/4决赛胜者 → 出现在半决赛
  if (/^RD16\s?W?\d?/.test(abbr) && abbr.includes('RD16')) return 3; // 1/8决赛胜者 → 1/4决赛
  if (abbr === 'RD32' || /^RD32/.test(abbr)) return 2;               // 1/16决赛胜者 → 1/8决赛
  return 1;                                    // 1A/2B/3RD → 出现在 1/16决赛
}
const ROUND_BY_LEVEL = ['', 'R32', 'R16', 'QF', 'SF', 'F', 'TP'];

async function main() {
  const local = JSON.parse(await readFile(DATA_FILE, 'utf8'));
  const idToGroup = Object.fromEntries(local.teams.map(t => [t.id, t.group]));
  const idToName = Object.fromEntries(local.teams.map(t => [t.id, t.nameCn]));
  const validIds = new Set(Object.keys(idToGroup));

  console.log('⏬ 正在拉取 ESPN 赛事数据…');
  const res = await fetch(ESPN_URL);
  if (!res.ok) throw new Error('ESPN 请求失败：HTTP ' + res.status);
  const data = await res.json();
  const events = data.events || [];
  console.log(`   共 ${events.length} 场赛事\n`);

  const groupResults = {};           // 小组赛已完赛比分
  const fixtures = {};               // 小组赛开球时间（所有场次，含未完赛）
  const knockout = { R32: [], R16: [], QF: [], SF: [], F: [], TP: [] };
  let groupDone = 0, koTotal = 0;

  for (const e of events) {
    const comp = e.competitions[0];
    const status = comp.status?.type?.name;
    const done = status === 'STATUS_FULL_TIME';

    const homeC = comp.competitors.find(t => t.homeAway === 'home');
    const awayC = comp.competitors.find(t => t.homeAway === 'away');
    if (!homeC || !awayC) continue;

    const homeAbbr = homeC.team.abbreviation;
    const awayAbbr = awayC.team.abbreviation;
    const homeReal = validIds.has(homeAbbr);
    const awayReal = validIds.has(awayAbbr);
    const venue = comp.venue?.fullName || comp.venue?.address?.city || '';

    // ---- 小组赛：两队真实且同组 ----
    if (homeReal && awayReal && idToGroup[homeAbbr] === idToGroup[awayAbbr]) {
      const group = idToGroup[homeAbbr];
      const [x, y] = [homeAbbr, awayAbbr].sort();
      const key = `G:${group}:${x}-${y}`;
      // 所有小组赛都记录赛程时间与场馆（不管是否完赛）
      fixtures[key] = { date: e.date, venue, homeAbbr, awayAbbr };
      if (!done) continue;
      const homeIsX = homeAbbr === x;
      const hs = parseInt(homeC.score, 10), as = parseInt(awayC.score, 10);
      groupResults[key] = {
        a: x, b: y, hs: homeIsX ? hs : as, as: homeIsX ? as : hs,
      };
      console.log(`  ✓ ${homeC.team.displayName} ${hs}-${as} ${awayC.team.displayName}`);
      groupDone++;
      continue;
    }

    // ---- 淘汰赛：按占位符推断轮次 ----
    const level = Math.max(slotRound(homeAbbr), slotRound(awayAbbr));
    const round = ROUND_BY_LEVEL[level] || 'R32';
    knockout[round].push({
      home: homeReal ? homeAbbr : homeAbbr,   // 真实ID 或 占位符字符串
      away: awayReal ? awayAbbr : awayAbbr,
      homeName: idToName[homeAbbr] || homeC.team.displayName,
      awayName: idToName[awayAbbr] || awayC.team.displayName,
      homeReal, awayReal,
      homeScore: done ? parseInt(homeC.score, 10) : null,
      awayScore: done ? parseInt(awayC.score, 10) : null,
      done,
      winner: done ? (parseInt(homeC.score,10) > parseInt(awayC.score,10) ? 'home'
                   : parseInt(homeC.score,10) < parseInt(awayC.score,10) ? 'away' : 'draw') : null,
      date: e.date, venue,
    });
    koTotal++;
  }

  const out = { ...groupResults, _fixtures: fixtures, knockout };
  await writeFile(OUT_FILE, JSON.stringify(out, null, 2));

  console.log(`\n✅ 同步完成：`);
  console.log(`   小组赛已完赛：${groupDone} 场`);
  console.log(`   小组赛开球时间：${Object.keys(fixtures).length} 场`);
  console.log(`   淘汰赛对阵：${koTotal} 场（R32:${knockout.R32.length} R16:${knockout.R16.length} QF:${knockout.QF.length} SF:${knockout.SF.length} F:${knockout.F.length} TP:${knockout.TP.length}）`);
  const koDone = Object.values(knockout).flat().filter(m => m.done).length;
  if (koDone) console.log(`   其中已完赛淘汰赛：${koDone} 场`);
  console.log(`   → ${OUT_FILE}`);
}

main().catch(err => { console.error('❌ 同步失败：', err.message); process.exit(1); });
