// ===== 小组积分榜视图 =====
import { computeStandings, computeThirdPlaceRanking } from '../data.js';

export function renderGroups(root, data, ctx) {
  const thirds = computeThirdPlaceRanking(data);
  const thirdIds = new Set(thirds.slice(0, 8).map(t => t.id));

  const groupCards = Object.keys(data.groups).map(g => {
    const st = computeStandings(data, g);
    const rows = st.map((r, idx) => {
      let cls = '';
      if (idx < 2) cls = 'qual';
      else if (idx === 2 && thirdIds.has(r.id)) cls = 'qual-3rd';
      return `
        <tr class="${cls}">
          <td>${idx + 1}</td>
          <td class="team-cell"><span class="flag">${r.team.flag}</span>${r.team.nameCn}</td>
          <td>${r.p}</td>
          <td>${r.w}</td>
          <td>${r.d}</td>
          <td>${r.l}</td>
          <td>${r.gf}:${r.ga}</td>
          <td>${r.gd > 0 ? '+' : ''}${r.gd}</td>
          <td class="pts">${r.pts}</td>
        </tr>`;
    }).join('');

    return `
      <div class="card group-card">
        <div class="ghead">小组 ${g}</div>
        <table class="standings">
          <thead><tr>
            <th>#</th><th class="team-cell">球队</th>
            <th>赛</th><th>胜</th><th>平</th><th>负</th>
            <th>进/失</th><th>净</th><th>分</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  root.innerHTML = `
    <div class="view-head">
      <h2>小组积分榜</h2>
      <p>录入比分后积分榜自动更新（用「赛程」页录入）。前两名直接出线，绿底标记；最好的 8 个第三名出线，蓝底标记。</p>
    </div>
    <div class="legend">
      <span><span class="dot" style="background:rgba(74,222,128,.4)"></span>小组前 2 名（直接出线）</span>
      <span><span class="dot" style="background:rgba(56,189,248,.45)"></span>最好的第三名（出线）</span>
    </div>
    <div class="grid grid-3" style="margin-top:16px;">
      ${groupCards}
    </div>
    ${thirds.length ? `
      <div class="card" style="margin-top:18px;">
        <h3>🔢 第三名排行榜（实时）</h3>
        <table class="standings">
          <thead><tr>
            <th>排名</th><th class="team-cell">球队</th><th>所在组</th>
            <th>赛</th><th>胜</th><th>平</th><th>负</th><th>进/失</th><th>净</th><th>分</th>
          </tr></thead>
          <tbody>
            ${thirds.map((t, i) => `
              <tr class="${i < 8 ? 'qual-3rd' : ''}">
                <td>${i + 1}${i < 8 ? ' ✅' : ''}</td>
                <td class="team-cell"><span class="flag">${t.team.flag}</span>${t.team.nameCn}</td>
                <td>${t.group}</td>
                <td>${t.p}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td>
                <td>${t.gf}:${t.ga}</td><td>${t.gd > 0 ? '+' : ''}${t.gd}</td><td class="pts">${t.pts}</td>
              </tr>`).join('')}
          </tbody>
        </table>
        <p class="muted" style="font-size:12.5px;margin-top:8px;">
          前 8 名晋级 1/16 决赛。该榜单会随小组赛比分实时变化。
        </p>
      </div>` : ''}
  `;
}
