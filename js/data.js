// ===== 数据加载层 =====
// 职责：加载 JSON 数据集、读写用户录入的比分（localStorage）、
// 派生赛程/积分榜/淘汰赛对阵。这里把"数据从哪来"与"视图如何渲染"隔开，
// 以后想接 football-data.org 等 API，只改本文件即可，视图不动。

const RESULTS_KEY = 'wc2026_results_v1';

export async function loadData() {
  const res = await fetch('data/worldcup2026.json');
  if (!res.ok) throw new Error('数据加载失败：' + res.status);
  const data = await res.json();

  // 比分来源（两层合并，手动优先）：
  //   1. data/results.json —— 由 sync.mjs 从 ESPN 自动同步（已完赛比分）
  //   2. localStorage      —— 你在赛程页手动录入/修正的，覆盖前者
  let autoResults = {};
  try {
    const r2 = await fetch('data/results.json');
    if (r2.ok) autoResults = await r2.json();
  } catch { /* results.json 不存在时忽略，不影响使用 */ }

  data.results = { ...autoResults, ...loadResults() };
  data.teamMap = Object.fromEntries(data.teams.map(t => [t.id, t]));

  // 赔率数据：由 scripts/sync-odds.mjs 同步到 data/odds.json
  // 缺失不影响其他功能
  try {
    const r3 = await fetch('data/odds.json');
    if (r3.ok) data.odds = await r3.json();
  } catch { /* odds.json 不存在时忽略 */ }
  data.odds = data.odds || { meta: { fetchedAt: null }, matches: [] };

  return data;
}

export function loadResults() {
  try { return JSON.parse(localStorage.getItem(RESULTS_KEY) || '{}'); }
  catch { return {}; }
}

export function saveResults(results) {
  localStorage.setItem(RESULTS_KEY, JSON.stringify(results));
}

// 比分 key：小组赛用 "G:A:MEX-RSA" 形式唯一标识一场小组赛
export function groupMatchKey(groupId, a, b) {
  return `G:${groupId}:${[a, b].sort().join('-')}`;
}

export function setGroupResult(results, key, home, away, hs, as) {
  // 保存主客队 + 比分；用排序后的 key 存，渲染时按 home/away 还原方向
  const [a, b] = [home, away].sort();
  const homeIsA = home === a;
  results[key] = {
    a, b,
    hs: homeIsA ? hs : as,
    as: homeIsA ? as : hs,
  };
  saveResults(results);
}

export function getGroupResult(results, key, home, away) {
  const r = results[key];
  if (!r) return null;
  const homeIsA = home === r.a;
  return {
    hs: homeIsA ? r.hs : r.as,
    as: homeIsA ? r.as : r.hs,
  };
}

export function clearResults() {
  localStorage.removeItem(RESULTS_KEY);
}

// 生成某一组的小组赛（单循环，每队 3 场，共 6 场/组）
export function groupFixtures(groupId, teamIds) {
  const fixtures = [];
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      fixtures.push({
        group: groupId,
        home: teamIds[i],
        away: teamIds[j],
        key: groupMatchKey(groupId, teamIds[i], teamIds[j]),
      });
    }
  }
  return fixtures;
}

// 计算积分榜（含 FIFA 官方平分规则：积分→净胜球→进球数）
export function computeStandings(data, groupId) {
  const ids = data.groups[groupId];
  const table = ids.map(id => ({
    id, team: data.teamMap[id],
    p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0,
  }));
  const byId = Object.fromEntries(table.map(t => [t.id, t]));

  for (const fx of groupFixtures(groupId, ids)) {
    const r = getGroupResult(data.results, fx.key, fx.home, fx.away);
    if (!r) continue;
    const h = byId[fx.home], a = byId[fx.away];
    h.p++; a.p++;
    h.gf += r.hs; h.ga += r.as;
    a.gf += r.as; a.ga += r.hs;
    if (r.hs > r.as) { h.w++; a.l++; h.pts += 3; }
    else if (r.hs < r.as) { a.w++; h.l++; a.pts += 3; }
    else { h.d++; a.d++; h.pts++; a.pts++; }
  }
  table.forEach(t => (t.gd = t.gf - t.ga));
  table.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.team.elo - x.team.elo);
  return table;
}

// 全局：所有小组第三名排名，用于选出"最好的 8 个第三名"
export function computeThirdPlaceRanking(data) {
  const thirds = [];
  for (const g of 'ABCDEFGHIJKL') {
    const st = computeStandings(data, g);
    if (st[2]) thirds.push({ group: g, ...st[2] });
  }
  thirds.sort((x, y) => y.pts - x.pts || y.gd - x.gd || y.gf - x.gf || y.team.elo - x.team.elo);
  return thirds;
}

// ISO 时间 → 本地时区显示（如 "6/12 03:00"）。中国用户即北京时间。
export function fmtLocal(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const mo = d.getMonth() + 1, da = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${mo}/${da} ${hh}:${mm}`;
}

// 绑定预测按钮：点击跳到预测页并选中该场两队（供赛程/对阵图复用）
export function bindPredict(scope) {
  scope.querySelectorAll('.pred-btn').forEach(b => {
    b.addEventListener('click', (e) => {
      e.stopPropagation();              // 阻止冒泡到比赛行（避免触发比分编辑器）
      location.hash = `predictor?h=${b.dataset.h}&a=${b.dataset.a}`;
    });
  });
}
