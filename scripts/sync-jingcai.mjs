#!/usr/bin/env node
// ===== 2026 世界杯竞彩赔率同步脚本 =====
// 数据源：中国竞彩网 webapi.sporttery.cn（非公开接口，个人低频自用）
// 玩法：had(胜平负) / hhad(让球胜平负) / crs(比分) / ttg(总进球) / hafu(半全场)
//
// 用法：node scripts/sync-jingcai.mjs
//       每次 5 个请求，低频安全。存 data/odds-jingcai.json
//
// 合规提醒：本脚本仅供个人数据分析自用。中国体育彩票只能在实体店购买，
//           不得通过任何非官方渠道购彩。禁止商用、禁止高频访问。

import { writeFile, readFile } from 'fs/promises';

const POOLS = ['had', 'hhad', 'crs', 'ttg', 'hafu'];
const API_URL = 'https://webapi.sporttery.cn/gateway/jc/football/getMatchCalculatorV1.qry';
const OUT_FILE = 'data/odds-jingcai.json';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9',
  'Referer': 'https://www.sporttery.cn/',
  'Origin': 'https://www.sporttery.cn',
};

// 竞彩队名 → 数据集 id（兜底映射，nameCn 直接匹配优先）
const ALIASES = {
  '波黑': 'BIH', '波斯尼亚和黑塞哥维那': 'BIH',
  '科特迪瓦': 'CIV', '象牙海岸': 'CIV', "科特迪瓦共和国": 'CIV',
  '佛得角': 'CPV', '卡博佛得角': 'CPV',
  '库拉索': 'CUW',
  '刚果民主共和国': 'COD', '刚果(金)': 'COD', '民主刚果': 'COD',
  '捷克': 'CZE', '捷克共和国': 'CZE',
  '美国': 'USA', '土耳其': 'TUR', '韩国': 'KOR', '伊朗': 'IRN',
  '沙特阿拉伯': 'KSA', '沙特': 'KSA',
};

async function loadAliases() {
  const local = JSON.parse(await readFile('data/worldcup2026.json', 'utf8'));
  const base = Object.fromEntries(local.teams.map(t => [t.nameCn, t.id]));
  return { ...base, ...ALIASES };
}

// 竞彩 crs 字段 sHHsAA → { "H-A": odds }
function parseCrs(crs) {
  if (!crs || typeof crs !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(crs)) {
    if (!k.startsWith('s') || k.endsWith('f') || k === 'goalLine' || k === 'goalLineValue') continue;
    // s01s01 → h=01, a=01
    const m = k.match(/^s(\d{2})s(\d{2})$/);
    if (!m) continue;
    const val = parseFloat(v);
    if (isNaN(val) || val <= 0) continue;
    out[`${parseInt(m[1])}-${parseInt(m[2])}`] = val;
  }
  return out;
}

// 竞彩 ttg 字段 → { "0": odds, "1": odds, ... }
function parseTtg(ttg) {
  if (!ttg || typeof ttg !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(ttg)) {
    if (!k.startsWith('s') || k.endsWith('f') || k === 'goalLine' || k === 'goalLineValue') continue;
    const m = k.match(/^s(\d)$/);
    if (!m) continue;
    const val = parseFloat(v);
    if (isNaN(val) || val <= 0) continue;
    out[m[1]] = val;
  }
  return out;
}

// 解析 had/hhad：取 h/d/a 赔率
function parseHad(had) {
  if (!had || typeof had !== 'object') return null;
  const h = parseFloat(had.h), d = parseFloat(had.d), a = parseFloat(had.a);
  if (isNaN(h) || isNaN(d) || isNaN(a)) return null;
  return { h, d, a };
}

// 解析 hhad：让球数 + h/d/a
function parseHhad(hhad) {
  if (!hhad || typeof hhad !== 'object') return null;
  const goalLine = parseFloat(hhad.goalLine);
  const parsed = parseHad(hhad);
  if (!parsed) return null;
  return { goalLine, ...parsed };
}

async function fetchPool(pool) {
  const url = `${API_URL}?poolCode=${pool}&channel=c`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`${pool} 请求失败：HTTP ${res.status}`);
  const data = await res.json();
  if (!data.success) throw new Error(`${pool} 接口报错：${data.errorMessage}`);
  return data.value?.matchInfoList || [];
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const aliases = await loadAliases();
  console.log(`📋 加载 ${Object.keys(aliases).length} 队别名映射\n`);

  // 逐 pool 拉取
  const matchMap = new Map();  // matchId → 合并后的 match 对象
  let totalFetched = 0;

  for (const pool of POOLS) {
    console.log(`⏬ 拉 ${pool}...`);
    try {
      const days = await fetchPool(pool);
      let count = 0;
      for (const day of days) {
        for (const m of day.subMatchList || []) {
          const id = m.matchId;
          if (!matchMap.has(id)) {
            // 队名映射
            const homeNameCn = m.homeTeamAllName || '';
            const awayNameCn = m.awayTeamAllName || '';
            matchMap.set(id, {
              matchId: id,
              businessDate: m.businessDate || day.businessDate,
              matchDate: m.matchDate,
              matchTime: m.matchTime,
              matchNumStr: m.matchNumStr || '',
              homeId: aliases[homeNameCn] || null,
              awayId: aliases[awayNameCn] || null,
              homeName: homeNameCn,
              awayName: awayNameCn,
            });
          }
          const match = matchMap.get(id);
          // 按 pool 合并数据
          if (pool === 'had') match.had = parseHad(m.had);
          if (pool === 'hhad') match.hhad = parseHhad(m.hhad);
          if (pool === 'crs') match.crs = parseCrs(m.crs);
          if (pool === 'ttg') match.ttg = parseTtg(m.ttg);
          if (pool === 'hafu') match.hafu = m.hafu || {};
          count++;
        }
      }
      console.log(`   ${count} 场（${days.length} 个比赛日）`);
      totalFetched++;
    } catch (e) {
      console.error(`   ⚠️ ${pool} 失败：${e.message}`);
    }
    await sleep(500);  // 请求间隔，避免触发 WAF
  }

  const matches = [...matchMap.values()];

  // 检查未匹配队名
  const unmapped = matches.filter(m => !m.homeId || !m.awayId);
  if (unmapped.length) {
    console.warn('\n⚠️ 以下比赛队名未匹配到数据集：');
    for (const m of unmapped) {
      console.warn(`   ${m.homeName} vs ${m.awayName}（${m.matchNumStr}）`);
    }
  }

  const out = {
    meta: {
      source: 'sporttery.cn (竞彩官方)',
      fetchedAt: new Date().toISOString(),
      pools: POOLS,
      matchCount: matches.length,
      fetchedPools: totalFetched,
    },
    matches,
  };

  await writeFile(OUT_FILE, JSON.stringify(out, null, 2));
  const unmappedIds = unmapped.filter(m => m.homeId || m.awayId).length;
  console.log(`\n✅ 写入 ${OUT_FILE}：${matches.length} 场（${unmappedIds} 场部分匹配）`);
  console.log('   含玩法：had/hhad/crs/ttg/hafu');
}

main().catch(err => { console.error('❌ 同步失败：', err.message); process.exit(1); });
