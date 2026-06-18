// ===== 淘汰赛对阵图（数据驱动：从 sync.mjs 同步的 ESPN 对阵渲染）=====
// 数据来源 data.results.knockout，按轮次 R32→R16→QF→SF→F (+TP季军赛)。
// 占位符(1A/2B/3RD)优先用小组积分榜推导成真实球队；推导不出则显示文字占位。

import { computeStandings, computeThirdPlaceRanking, fmtLocal, bindPredict } from '../data.js';

const ROUND_LABEL = {
  R32: '1/16 决赛', R16: '1/8 决赛', QF: '1/4 决赛', SF: '半决赛', F: '决赛', TP: '季军赛',
};
const ROUND_DATE = {
  R32: '6/28 – 7/4', R16: '7/4 – 7/7', QF: '7/9 – 7/12', SF: '7/14 – 7/15', F: '7/19', TP: '7/18',
};

// 把 ESPN 的占位符描述翻译成更友好的中文，并尽量推导出真实球队
function describeSlot(abbr, isReal, name, data, thirds) {
  if (isReal) {
    const t = data.teamMap[abbr];
    return t ? { flag: t.flag, name: t.nameCn, real: true } : { flag: '', name, real: false };
  }
  // 占位符
  const m = abbr;
  if (/^[12][A-L]$/.test(m)) {
    const pos = m[0], grp = m.slice(1);
    const st = computeStandings(data, grp);
    const team = st[parseInt(pos, 10) - 1]?.team;
    if (team) return { flag: team.flag, name: team.nameCn, real: true, derived: `${pos}${grp}` };
    return { flag: '', name: `小组${grp}第${pos}`, real: false };
  }
  if (m === '3RD') {
    if (thirds.length) return { flag: thirds[0].team.flag, name: `最好第三名·${thirds[0].team.nameCn}`, real: false, derived: '3RD' };
    return { flag: '', name: '最好的第三名', real: false };
  }
  if (/^RD32/.test(m)) return { flag: '', name: '1/16决赛胜者', real: false };
  if (/^RD16/.test(m)) return { flag: '', name: '1/8决赛胜者', real: false };
  if (/^QF/.test(m)) return { flag: '', name: '1/4决赛胜者', real: false };
  if (/^SFW/.test(m)) return { flag: '', name: '半决赛胜者', real: false };
  if (/^SF\s*L/.test(m)) return { flag: '', name: '半决赛负者', real: false };
  return { flag: '', name, real: false };
}

function matchHtml(match, data, thirds) {
  const home = describeSlot(match.home, match.homeReal, match.homeName, data, thirds);
  const away = describeSlot(match.away, match.awayReal, match.awayName, data, thirds);
  const hWin = match.winner === 'home', aWin = match.winner === 'away';
  const scoreStr = match.done ? `${match.homeScore} - ${match.awayScore}` : null;
  const dim = (winner, ok) => winner && !ok ? 'opacity:.45;' : '';
  const cls = match.done ? 'done' : '';
  // 两队都已确定真实球队 → 可预测
  const canPredict = match.homeReal && match.awayReal;
  // 未完赛显示开球时间（本地时区）
  const timeStr = !match.done && match.date ? fmtLocal(match.date) : '';

  return `<div class="slot ${cls}" style="min-height:auto;">
    ${match.venue ? `<div class="mnum">${match.venue}</div>` : ''}
    <div class="line">
      <div class="side" style="${dim(hWin,true)}">
        <span class="flag">${home.flag || '🏳️'}</span>
        <span class="nm">${home.name}</span>
      </div>
      <span class="sc">${match.done ? (hWin ? '<b>'+match.homeScore+'</b>' : match.homeScore) : ''}</span>
    </div>
    <div class="line">
      <div class="side" style="${dim(aWin,true)}">
        <span class="flag">${away.flag || '🏳️'}</span>
        <span class="nm">${away.name}</span>
      </div>
      <span class="sc">${match.done ? (aWin ? '<b>'+match.awayScore+'</b>' : match.awayScore) : ''}</span>
    </div>
    ${timeStr ? `<div class="match-time">⏰ ${timeStr}</div>` : ''}
    ${canPredict ? `<button class="pred-btn" data-h="${match.home}" data-a="${match.away}">🔮 预测</button>` : ''}
  </div>`;
}

// 判断比赛属于哪个半区（前半上半区、后半下半区）
// R32:[0-7]=上,[8-15]=下  R16:[0-3]=上,[4-7]=下  QF:[0-1]=上,[2-3]=下  SF:[0]=上,[1]=下
function halfZone(round, index, total) {
  if (round === 'F' || round === 'TP') return null;
  return index < total / 2 ? 'upper' : 'lower';
}

export function renderBracket(root, data) {
  const ko = data.results?.knockout;
  const thirds = computeThirdPlaceRanking(data);
  const rounds = ['R32', 'R16', 'QF', 'SF', 'F', 'TP'];

  if (!ko || !ko.R32) {
    root.innerHTML = noData();
    return;
  }

  const cols = rounds.filter(r => ko[r] && ko[r].length).map(r => `
    <div class="bracket-col">
      <h4>${ROUND_LABEL[r]}<small>${ROUND_DATE[r]} · ${ko[r].length}场</small></h4>
      ${ko[r].map((m, i) => {
        const zone = halfZone(r, i, ko[r].length);
        const zoneTag = zone ? `<span class="zone-tag zone-${zone}">${zone === 'upper' ? '上半区' : '下半区'}</span>` : '';
        return zoneTag + matchHtml(m, data, thirds);
      }).join('')}
    </div>`).join('');

  const koDone = Object.values(ko).flat().filter(m => m.done).length;
  // 上半区/下半区的代表队（从 R32 推导）
  const r32 = ko.R32;
  const upperTeams = r32.slice(0, 8).map(m => describeSlot(m.home, m.homeReal, m.homeName, data, thirds).name + ' vs ' + describeSlot(m.away, m.awayReal, m.awayName, data, thirds).name);
  const lowerTeams = r32.slice(8, 16).map(m => describeSlot(m.home, m.homeReal, m.homeName, data, thirds).name + ' vs ' + describeSlot(m.away, m.awayReal, m.awayName, data, thirds).name);

  root.innerHTML = `
    <div class="view-head">
      <h2>淘汰赛对阵图</h2>
      <p>48 队 → 32 队淘汰赛。前 2 名 + 8 个最佳第三名晋级，分<strong>上半区</strong>和<strong>下半区</strong>两条通道，
        各自决出一个决赛名额。西班牙与阿根廷被安排在不同半区（FIFA 排名保护），最早只能在决赛相遇。</p>
    </div>

    <div class="zone-summary">
      <div class="zone-card zone-upper-card">
        <h4>🔺 上半区（${r32.length >= 8 ? '8 场 1/16 决赛' : ''}）</h4>
        <div class="zone-desc">对阵通道：1/16 → 1/8 → 1/4 → 半决赛 → 决赛</div>
      </div>
      <div class="zone-card zone-lower-card">
        <h4>🔻 下半区（${r32.length >= 16 ? '8 场 1/16 决赛' : ''}）</h4>
        <div class="zone-desc">对阵通道：1/16 → 1/8 → 1/4 → 半决赛 → 决赛</div>
      </div>
    </div>

    <div class="bracket-wrap">
      <div class="bracket">${cols}</div>
    </div>

    <div class="bracket-note">
      <b>📌 半区与对位说明</b><br>
      • <span class="zone-tag zone-upper" style="font-size:11px;">上半区</span> 和
        <span class="zone-tag zone-lower" style="font-size:11px;">下半区</span> 标注了每场比赛所属的半区通道<br>
      • 1/16 决赛前 8 场 → 上半区，后 8 场 → 下半区，各自独立晋级直到半决赛<br>
      • 半决赛：上半区胜者 vs 上半区胜者，下半区胜者 vs 下半区胜者，两场胜者会师决赛<br>
      • 西班牙（FIFA #1）和阿根廷（FIFA #2）被分在不同半区，最早只能在决赛相遇<br>
      • 两队都已确定时可点「🔮 预测」分析该场
      ${koDone ? `<br>• 已完赛 <b>${koDone}</b> 场` : '<br>• 淘汰赛尚未开始'}
    </div>
  `;
  bindPredict(root);
}

function noData() {
  return `
    <div class="view-head">
      <h2>淘汰赛对阵图</h2>
      <p>对阵数据尚未同步。运行 <code>npm run sync</code> 后刷新即可看到完整的 1/16 决赛对阵。</p>
    </div>
    <div class="bracket-note">
      尚无淘汰赛数据。请在终端执行：<br>
      <code style="color:var(--accent)">npm run sync</code>
    </div>`;
}
