#!/usr/bin/env node
// ===== 2026 世界杯实时赔率同步脚本 =====
// 数据源：the-odds-api（免费层 500 次/月，需注册拿 API key）
// 文档：https://the-odds-api.com/liveapi/guides/v4/
//
// 用法：
//   export ODDS_API_KEY=你的key        # 必填
//   node scripts/sync-odds.mjs         # 拉一次，存到 data/odds.json
//   node scripts/sync-odds.mjs --watch # 每 6 小时拉一次（适合 launchd/cron 常驻）
//
// markets：
//   h2h     胜平负（1X2）—— 主线
//   spreads 让球胜平负（亚洲让球）
//   totals  大小球（总进球 O/U）
// （the-odds-api 不提供"正确比分"市场，比分分布由模型生成）
//
// 注：拉取所有 bookmaker 会让响应很大。我们只保留主流的几家，
//     并且把同一场比赛的多个市场合并到一个对象里。

import { writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';

const API_BASE = 'https://api.the-odds-api.com/v4';
const SPORT_KEY = 'soccer_fifa_world_cup';
const REGIONS = 'us,eu,uk';           // 拉美国/欧洲/英国 bookmaker
const MARKETS = ['h2h', 'spreads', 'totals'];
const ODDS_FILE = 'data/odds.json';

// 保留的 bookmaker（按业界声誉，Pinnacle 是"sharp"线代表）
const KEEP_BOOKMAKERS = new Set([
  'pinnacle',   // sharp 线，市场共识风向标
  'draftkings', 'fanduel', 'betmgm',   // 美国主流
  'bet365',     // 全球
  'williamhill', 'unibet', 'bwin',     // 欧洲
]);

const apiKey = process.env.ODDS_API_KEY;
if (!apiKey) {
  console.error('❌ 缺少 ODDS_API_KEY 环境变量');
  console.error('   去 https://the-odds-api.com 注册（免费），然后：');
  console.error('   export ODDS_API_KEY=你的key');
  process.exit(1);
}

// the-odds-api 用的队名 → 数据集 id（API 名跟 FIFA 官方名有出入）
const API_ALIASES = {
  'Czech Republic': 'CZE',
  'Bosnia & Herzegovina': 'BIH',
  'Turkey': 'TUR',
  'Ivory Coast': 'CIV',
  'Cape Verde': 'CPV',
  'Iran': 'IRN',
};

// 已知 2026 世界杯 48 队 ID 映射 the-odds-api 用的队名（拉取后手动校准）
// 这里只放一个空模板，第一次跑完后会输出未匹配的队名让你补全。
async function loadTeamAliases() {
  const local = JSON.parse(await readFile('data/worldcup2026.json', 'utf8'));
  const base = Object.fromEntries(local.teams.map(t => [t.name, t.id]));
  return { ...base, ...API_ALIASES };
}

async function fetchOdds() {
  const all = [];
  for (const market of MARKETS) {
    const url = `${API_BASE}/sports/${SPORT_KEY}/odds` +
      `?apiKey=${apiKey}&regions=${REGIONS}&markets=${market}&oddsFormat=decimal`;
    console.log(`⏬ 拉 ${market} 市场…`);
    const res = await fetch(url);
    if (!res.ok) {
      const t = await res.text();
      console.error(`   ⚠️ ${market} 失败：HTTP ${res.status} ${t.slice(0, 200)}`);
      continue;
    }
    const data = await res.json();
    console.log(`   收到 ${(data || []).length} 场，剩余额度：${res.headers.get('x-requests-remaining') || '?'}`);
    all.push({ market, events: data });
  }
  return all;
}

// 把多个 markets 的数据按 matchId 合并
function mergeByMatch(rawMarkets, aliases) {
  const byId = new Map();
  for (const { market, events } of rawMarkets) {
    for (const ev of events) {
      const id = ev.id;
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          commenceTime: ev.commence_time,
          homeName: ev.home_team,
          awayName: ev.away_team,
          homeId: aliases[ev.home_team] || null,
          awayId: aliases[ev.away_team] || null,
          bookmakers: {},
        });
      }
      const match = byId.get(id);
      for (const bm of ev.bookmakers || []) {
        if (!KEEP_BOOKMAKERS.has(bm.key)) continue;
        if (!match.bookmakers[bm.key]) match.bookmakers[bm.key] = { title: bm.title, lastUpdate: bm.last_update };
        for (const outcome of bm.markets || []) {
          if (outcome.key !== market) continue;
          if (!match.bookmakers[bm.key][market]) match.bookmakers[bm.key][market] = [];
          for (const o of outcome.outcomes) {
            match.bookmakers[bm.key][market].push({
              name: o.name,
              price: o.price,           // decimal odds
              point: o.point || null,   // 让球数 / 大小球线
            });
          }
        }
      }
    }
  }
  return [...byId.values()];
}

async function main() {
  const args = process.argv.slice(2);
  const watch = args.includes('--watch');

  const aliases = await loadTeamAliases();
  console.log(`📋 已加载 ${Object.keys(aliases).length} 队别名映射`);

  const runOnce = async () => {
    console.log(`\n[${new Date().toISOString()}] 开始同步赔率`);
    const raw = await fetchOdds();
    const merged = mergeByMatch(raw, aliases);
    const unmapped = merged.filter(m => !m.homeId || !m.awayId);
    if (unmapped.length) {
      console.warn('\n⚠️ 以下比赛队名未匹配到 2026 数据集，需要补全 data/worldcup2026.json 或别名表：');
      for (const m of unmapped.slice(0, 10)) {
        console.warn(`   - ${m.homeName} vs ${m.awayName}`);
      }
    }

    const out = {
      meta: {
        sport: SPORT_KEY,
        fetchedAt: new Date().toISOString(),
        bookmakers: [...KEEP_BOOKMAKERS],
        marketCount: MARKETS.length,
      },
      matches: merged,
    };

    await writeFile(ODDS_FILE, JSON.stringify(out, null, 2));
    console.log(`\n✅ 写入 ${ODDS_FILE}：${merged.length} 场比赛`);
  };

  await runOnce();
  if (watch) {
    console.log('\n⏰ watch 模式，每 6 小时同步一次（Ctrl+C 退出）');
    setInterval(runOnce, 6 * 3600 * 1000);
  }
}

main().catch(err => { console.error('❌ 同步失败：', err.message); process.exit(1); });
