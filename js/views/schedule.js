// ===== 赛程视图（按比赛日展示，支持点击录入比分 + 一键预测）=====
import { groupFixtures, getGroupResult, setGroupResult, fmtLocal, bindPredict } from '../data.js';

export function renderSchedule(root, data, ctx) {
  root.innerHTML = `
    <div class="view-head">
      <h2>小组赛赛程</h2>
      <p>每组单循环，共 6 场。点击中间的比分区域录入结果，积分榜和预测会同步更新。</p>
    </div>
    <div class="round-tabs" id="roundTabs"></div>
    <div id="schedBody"></div>
  `;

  const tabsEl = root.querySelector('#roundTabs');
  const bodyEl = root.querySelector('#schedBody');

  const rounds = [
    { key: 'today', label: '📅 今日' },
    { key: 'tomorrow', label: '📅 明日' },
    { key: '1', label: '第 1 比赛日' },
    { key: '2', label: '第 2 比赛日' },
    { key: '3', label: '第 3 比赛日' },
    { key: 'all', label: '全部' },
  ];

  let active = 'today';

  function drawTabs() {
    tabsEl.innerHTML = rounds.map(r =>
      `<button class="round-tab ${r.key === active ? 'active' : ''}" data-md="${r.key}">${r.label}</button>`
    ).join('');
    tabsEl.querySelectorAll('.round-tab').forEach(b =>
      b.addEventListener('click', () => { active = b.dataset.md; drawTabs(); drawBody(); })
    );
  }

  function drawBody() {
    if (active === 'today' || active === 'tomorrow') { drawDayView(active); return; }
    const groups = Object.keys(data.groups);
    const cards = groups.map(g => {
      const fixtures = groupFixtures(g, data.groups[g]);
      // 第 N 比赛日 = 每队的第 N 场。简化：按"组内第 N 轮"分配
      // 6 场拆成 3 轮，每轮 2 场：
      const rounds3 = [
        [fixtures[0], fixtures[1]],
        [fixtures[2], fixtures[3]],
        [fixtures[4], fixtures[5]],
      ];
      let show;
      if (active === 'all') show = fixtures;
      else show = rounds3[+active - 1];

      const rows = show.map(fx => {
        const h = data.teamMap[fx.home], a = data.teamMap[fx.away];
        const r = getGroupResult(data.results, fx.key, fx.home, fx.away);
        const scoreHtml = r
          ? `<span class="score">${r.hs} - ${r.as}</span>`
          : `<span class="score dash">VS</span>`;
        // 开球时间（来自 ESPN 同步，转本地时区显示）
        const fi = data.results._fixtures?.[fx.key];
        const timeHtml = fi?.date
          ? `<div class="match-time">⏰ ${fmtLocal(fi.date)}</div>${fi.venue ? `<div class="match-venue">🏟️ ${fi.venue}</div>` : ''}`
          : '';
        return `
          <div class="match-row editable" data-key="${fx.key}" data-home="${fx.home}" data-away="${fx.away}">
            <div class="team"><span class="flag">${h.flag}</span><span>${h.nameCn}</span></div>
            <div class="vs">${scoreHtml}${timeHtml}<button class="pred-btn" data-h="${fx.home}" data-a="${fx.away}" title="预测这场比赛">🔮 预测</button></div>
            <div class="team right"><span>${a.nameCn}</span><span class="flag">${a.flag}</span></div>
          </div>`;
      }).join('');

      return `
        <div class="card">
          <h3><span class="tag">${g}</span>小组赛</h3>
          ${rows}
        </div>`;
    }).join('');

    bodyEl.innerHTML = `<div class="grid grid-2">${cards}</div>`;

    bodyEl.querySelectorAll('.match-row').forEach(row =>
      row.addEventListener('click', () => openEditor(row))
    );
    bindPredict(bodyEl);
  }

  // 渲染单场比赛行（今日视图复用，带组别标签）
  function rowHtml(g, fx, fi) {
    const h = data.teamMap[fx.home], a = data.teamMap[fx.away];
    const r = getGroupResult(data.results, fx.key, fx.home, fx.away);
    const scoreHtml = r ? `<span class="score">${r.hs} - ${r.as}</span>` : `<span class="score dash">VS</span>`;
    const timeHtml = fi?.date ? `<div class="match-time">⏰ ${fmtLocal(fi.date)}</div>` : '';
    return `<div class="match-row editable" data-key="${fx.key}" data-home="${fx.home}" data-away="${fx.away}">
      <div class="team"><span class="grp-tag">${g}</span><span class="flag">${h.flag}</span><span>${h.nameCn}</span></div>
      <div class="vs">${scoreHtml}${timeHtml}<button class="pred-btn" data-h="${fx.home}" data-a="${fx.away}">🔮 预测</button></div>
      <div class="team right"><span>${a.nameCn}</span><span class="flag">${a.flag}</span></div>
    </div>`;
  }

  function drawDayView(which) {
    const target = new Date();
    if (which === 'tomorrow') target.setDate(target.getDate() + 1);
    const targetStr = target.toDateString();
    const dateLabel = target.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
    const dayName = which === 'tomorrow' ? '明日' : '今日';

    // 收集所有带时间的小组赛
    const all = [];
    for (const g of Object.keys(data.groups)) {
      for (const fx of groupFixtures(g, data.groups[g])) {
        const fi = data.results._fixtures?.[fx.key];
        if (fi?.date) all.push({ g, fx, fi });
      }
    }
    all.sort((x, y) => new Date(x.fi.date) - new Date(y.fi.date));

    const dayList = all.filter(m => new Date(m.fi.date).toDateString() === targetStr);

    if (dayList.length) {
      const rows = dayList.map(m => rowHtml(m.g, m.fx, m.fi)).join('');
      bodyEl.innerHTML = `<div class="card"><h3>📅 ${dateLabel} · ${dayName} ${dayList.length} 场</h3>${rows}</div>`;
      bodyEl.querySelectorAll('.match-row').forEach(row => row.addEventListener('click', () => openEditor(row)));
      bindPredict(bodyEl);
      return;
    }

    // 当日无比赛 → 显示下一场
    const now = Date.now();
    const next = all.find(m => new Date(m.fi.date).getTime() > now);
    let nextHtml = '<p class="muted">暂无后续赛程信息（运行 npm run sync 同步）。</p>';
    if (next) {
      nextHtml = rowHtml(next.g, next.fx, next.fi)
        + `<p class="hint">下一场比赛在 <b style="color:var(--accent-2)">${fmtLocal(next.fi.date)}</b>，还剩 ${countdown(next.fi.date)}。</p>`;
    }
    bodyEl.innerHTML = `<div class="card"><h3>📅 ${dateLabel} · ${dayName}无比赛</h3>${nextHtml}<p class="hint">点上方「第 N 比赛日」或「全部」查看完整赛程。</p></div>`;
    bodyEl.querySelectorAll('.match-row').forEach(row => row.addEventListener('click', () => openEditor(row)));
    bindPredict(bodyEl);
  }

  // 倒计时文案
  function countdown(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    if (diff <= 0) return '即将开始';
    const h = Math.floor(diff / 3600000);
    const d = Math.floor(h / 24);
    if (d > 0) return `${d} 天 ${h % 24} 小时`;
    if (h > 0) return `${h} 小时 ${Math.floor((diff % 3600000) / 60000)} 分`;
    return `${Math.floor(diff / 60000)} 分钟`;
  }

  function openEditor(row) {
    const key = row.dataset.key;
    const home = row.dataset.home;
    const away = row.dataset.away;
    const h = data.teamMap[home], a = data.teamMap[away];
    const cur = getGroupResult(data.results, key, home, away);

    const mask = document.createElement('div');
    mask.className = 'modal-mask show';
    mask.innerHTML = `
      <div class="modal">
        <h3>录入比分</h3>
        <div class="match-info">小组赛 · ${h.nameCn} vs ${a.nameCn}</div>
        <div class="score-input-row">
          <div class="side-name"><div class="flag">${h.flag}</div><div>${h.nameCn}</div></div>
          <input type="number" min="0" max="20" id="hs" value="${cur ? cur.hs : ''}" inputmode="numeric" />
          <input type="number" min="0" max="20" id="as" value="${cur ? cur.as : ''}" inputmode="numeric" />
          <div class="side-name"><div class="flag">${a.flag}</div><div>${a.nameCn}</div></div>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">取消</button>
          <button class="btn btn-ghost" data-act="clear">清除</button>
          <button class="btn btn-primary" data-act="save">保存</button>
        </div>
      </div>`;
    document.body.appendChild(mask);

    mask.addEventListener('click', (e) => {
      if (e.target === mask) mask.remove();
      const act = e.target.dataset?.act;
      if (act === 'cancel') mask.remove();
      if (act === 'clear') { delete data.results[key]; localStorage.setItem('wc2026_results_v1', JSON.stringify(data.results)); mask.remove(); ctx.refresh(); }
      if (act === 'save') {
        const hs = parseInt(mask.querySelector('#hs').value, 10);
        const as = parseInt(mask.querySelector('#as').value, 10);
        if (isNaN(hs) || isNaN(as) || hs < 0 || as < 0) { alert('请输入有效的比分'); return; }
        setGroupResult(data.results, key, home, away, hs, as);
        mask.remove();
        ctx.refresh();
      }
    });
  }

  drawTabs();
  drawBody();
}
