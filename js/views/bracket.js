// ===== 淘汰赛对阵图（左右分区版）=====
// 经典 tournament bracket 布局：
//   左侧（上半区）R32→R16→QF→SF → 决赛 ← SF←QF←R16←R32 右侧（下半区）
// 每场比赛标识：队伍名 + 小组排名来源（如"A组第1""B组第2""最佳第三"）
// 对位关系用颜色边框标注（同色 = 同一晋级通道）

import { computeStandings, computeThirdPlaceRanking, fmtLocal, bindPredict } from '../data.js';

// 轮次标签
const RL = { R32: '1/16 决赛', R16: '1/8 决赛', QF: '1/4 决赛', SF: '半决赛', F: '决赛', TP: '季军赛' };
// 对位颜色（8 个通道：上半区 4 + 下半区 4）
const PAIR_COLORS = ['#38bdf8', '#4ade80', '#fbbf24', '#f87171', '#c084fc', '#fb923c', '#34d399', '#f472b6'];

// 来源描述："1A" → "A组第1"，"2B" → "B组第2"，"3RD" → "最佳第三"
function originLabel(abbr) {
  if (!abbr) return '';
  if (/^[12][A-L]$/.test(abbr)) return abbr[1] + '组第' + abbr[0];
  if (abbr === '3RD') return '最佳第三';
  if (/^RD32/.test(abbr)) return '1/16决赛胜者';
  if (/^RD16/.test(abbr)) return '1/8决赛胜者';
  if (/^QF/.test(abbr)) return '1/4决赛胜者';
  if (/^SFW/.test(abbr)) return '半决赛胜者';
  if (/^SF\s*L/.test(abbr)) return '半决赛负者';
  return '';
}

// 推导占位符对应的真实球队
function resolveSlot(abbr, isReal, name, data, thirds) {
  if (isReal) {
    const t = data.teamMap[abbr];
    return t ? { flag: t.flag, name: t.nameCn, id: abbr } : { flag: '🏳️', name, id: abbr };
  }
  if (/^[12][A-L]$/.test(abbr)) {
    const pos = parseInt(abbr[0], 10), grp = abbr.slice(1);
    const st = computeStandings(data, grp);
    const team = st[pos - 1]?.team;
    if (team) return { flag: team.flag, name: team.nameCn, id: team.id, derived: abbr };
    return { flag: '🏳️', name: `${grp}组第${pos}`, id: abbr };
  }
  if (abbr === '3RD') {
    const t = thirds[0]?.team;
    return t ? { flag: t.flag, name: t.nameCn, id: t.id, derived: '3RD' } : { flag: '🏳️', name: '最佳第三', id: abbr };
  }
  return { flag: '🏳️', name: name || abbr, id: abbr };
}

// 渲染一场比赛的 slot
function slotHtml(match, data, thirds, pairColor) {
  const h = resolveSlot(match.home, match.homeReal, match.homeName, data, thirds);
  const a = resolveSlot(match.away, match.awayReal, match.awayName, data, thirds);
  const hOrigin = originLabel(match.home);
  const aOrigin = originLabel(match.away);
  const hWin = match.winner === 'home', aWin = match.winner === 'away';
  const scoreStr = match.done ? `${match.homeScore} - ${match.awayScore}` : null;
  const venue = match.venue || '';
  const timeStr = !match.done && match.date ? fmtLocal(match.date) : '';
  const canPredict = match.homeReal && match.awayReal;
  const borderC = pairColor || 'var(--line)';

  return `<div class="brk-slot" style="border-left:3px solid ${borderC}">
    <div class="brk-team${hWin ? ' brk-win' : ''}${match.done && !hWin ? ' brk-lose' : ''}">
      <span class="flag">${h.flag || '🏳️'}</span>
      <span class="brk-name">${h.name}</span>
      <span class="brk-origin">${hOrigin}</span>
    </div>
    <div class="brk-mid">
      ${scoreStr ? `<span class="brk-score">${scoreStr}</span>` : `<span class="brk-vs">vs</span>`}
      ${timeStr ? `<span class="brk-time">${timeStr}</span>` : ''}
    </div>
    <div class="brk-team${aWin ? ' brk-win' : ''}${match.done && !aWin ? ' brk-lose' : ''}">
      <span class="flag">${a.flag || '🏳️'}</span>
      <span class="brk-name">${a.name}</span>
      <span class="brk-origin">${aOrigin}</span>
    </div>
    ${venue ? `<div class="brk-venue">📍${venue}</div>` : ''}
    ${canPredict ? `<button class="pred-btn" data-h="${h.id}" data-a="${a.id}">🔮</button>` : ''}
  </div>`;
}

// 渲染一个半区（8 场 R32 → 4 场 R16 → 2 场 QF → 1 场 SF）
function halfHtml(rounds, data, thirds, pairOffset) {
  // rounds: { r32: [8], r16: [4], qf: [2], sf: [1] }
  const cols = [
    { key: 'r32', label: '1/16', pairStep: 2 },
    { key: 'r16', label: '1/8', pairStep: 1 },
    { key: 'qf',  label: '1/4', pairStep: 1 },
    { key: 'sf',  label: '半决赛', pairStep: 1 },
  ];

  return cols.map((col, ci) => {
    const matches = rounds[col.key] || [];
    const slots = matches.map((m, i) => {
      // 对位颜色：R32 两两一对（0,1→color0；2,3→color1...），R16 直接对应
      const pairIdx = ci === 0 ? Math.floor(i / 2) + pairOffset :
                      ci === 1 ? i + pairOffset :
                      ci === 2 ? i + pairOffset :
                      pairOffset;
      const color = PAIR_COLORS[pairIdx % PAIR_COLORS.length];
      return slotHtml(m, data, thirds, color);
    }).join('');
    return `<div class="brk-round"><div class="brk-round-lbl">${col.label}</div>${slots}</div>`;
  }).join('');
}

export function renderBracket(root, data) {
  const ko = data.results?.knockout;
  const thirds = computeThirdPlaceRanking(data);

  if (!ko || !ko.R32) {
    root.innerHTML = `<div class="view-head"><h2>淘汰赛对阵图</h2>
      <p>运行 <code>npm run sync</code> 后刷新，即可看到完整对阵。</p></div>`;
    return;
  }

  const r32 = ko.R32, r16 = ko.R16 || [], qf = ko.QF || [], sf = ko.SF || [], f = ko.F || [], tp = ko.TP || [];

  // 上半区：前半，下半区：后半
  const upper = { r32: r32.slice(0, 8), r16: r16.slice(0, 4), qf: qf.slice(0, 2), sf: sf[0] ? [sf[0]] : [] };
  const lower = { r32: r32.slice(8, 16), r16: r16.slice(4, 8), qf: qf.slice(2, 4), sf: sf[1] ? [sf[1]] : [] };

  // 决赛 + 季军赛
  const finalHtml = f[0] ? slotHtml(f[0], data, thirds, null) : '<div class="brk-slot brk-placeholder">决赛待定</div>';
  const thirdHtml = tp[0] ? slotHtml(tp[0], data, thirds, null) : '';

  const koDone = Object.values(ko).flat().filter(m => m.done).length;

  // 选位分析摘要（哪些强队在哪个半区）
  const upperTeams = r32.slice(0, 8).flatMap(m => {
    const h = resolveSlot(m.home, m.homeReal, m.homeName, data, thirds);
    const a = resolveSlot(m.away, m.awayReal, m.awayName, data, thirds);
    return [h.name, a.name];
  }).filter(n => n && n !== '最佳第三');
  const lowerTeams = r32.slice(8, 16).flatMap(m => {
    const h = resolveSlot(m.home, m.homeReal, m.homeName, data, thirds);
    const a = resolveSlot(m.away, m.awayReal, m.awayName, data, thirds);
    return [h.name, a.name];
  }).filter(n => n && n !== '最佳第三');

  root.innerHTML = `
    <div class="view-head">
      <h2>淘汰赛对阵图</h2>
      <p>48 队 → 32 队淘汰赛。分<strong>上半区</strong>（蓝色）和<strong>下半区</strong>（紫色）两条通道，
        各自决出一个决赛名额。同色边框 = 同一晋级通道（对位关系）。</p>
    </div>

    <div class="brk-summary">
      <div class="brk-sum-card" style="border-left:3px solid var(--accent-2)">
        <h4>🔺 上半区</h4>
        <div class="brk-sum-desc">${upperTeams.slice(0, 6).join('、')}${upperTeams.length > 6 ? '…' : ''}</div>
      </div>
      <div class="brk-sum-card" style="border-left:3px solid #c084fc">
        <h4>🔻 下半区</h4>
        <div class="brk-sum-desc">${lowerTeams.slice(0, 6).join('、')}${lowerTeams.length > 6 ? '…' : ''}</div>
      </div>
    </div>

    <div class="brk-split">
      <div class="brk-half brk-upper">
        ${halfHtml(upper, data, thirds, 0)}
      </div>

      <div class="brk-center">
        <div class="brk-center-label">决赛 · 7/19</div>
        ${finalHtml}
        ${thirdHtml ? `<div class="brk-center-label" style="margin-top:16px;">季军赛 · 7/18</div>${thirdHtml}` : ''}
      </div>

      <div class="brk-half brk-lower">
        ${halfHtml(lower, data, thirds, 4)}
      </div>
    </div>

    <div class="brk-note">
      <b>📌 对位说明</b><br>
      • <span style="color:#38bdf8">■</span> <span style="color:#4ade80">■</span> <span style="color:#fbbf24">■</span> <span style="color:#f87171">■</span> 上半区 4 条晋级通道 &nbsp;
        <span style="color:#c084fc">■</span> <span style="color:#fb923c">■</span> <span style="color:#34d399">■</span> <span style="color:#f472b6">■</span> 下半区 4 条晋级通道<br>
      • 同色边框的比赛属于同一晋级通道：R32 两场（同色）→ 胜者在 R16 对阵 → 一路到半决赛<br>
      • "A组第1" 等标注显示了每队的小组出线名次（占位符在小组赛结束后替换为真实队名）<br>
      • 西班牙（FIFA #1）和阿根廷（FIFA #2）被分在不同半区，最早只能在决赛相遇<br>
      • 两队都已确定时可点「🔮」预测该场${koDone ? ` · 已完赛 <b>${koDone}</b> 场` : ''}
    </div>
  `;
  bindPredict(root);
}
