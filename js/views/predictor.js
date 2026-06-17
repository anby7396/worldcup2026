// ===== 比赛预测助手视图 =====
// 选两支球队 → Elo + 泊松模型给出胜平负概率、最可能比分、比分热力图。

import { predict } from '../model/poisson.js';

export function renderPredictor(root, data, ctx) {
  const teams = [...data.teams].sort((a, b) => b.elo - a.elo);

  // 默认焦点对决：西班牙 vs 阿根廷；若带参数（从赛程/对阵图跳来）则用参数
  const ph = ctx.params?.h, pa = ctx.params?.a;
  let homeId = ph && data.teamMap[ph] ? ph : 'ESP';
  let awayId = pa && data.teamMap[pa] ? pa : 'ARG';

  root.innerHTML = `
    <div class="view-head">
      <h2>比赛预测助手</h2>
      <p>基于球队 Elo 实力评分 + 泊松进球模型，预测任意两队的胜平负概率、预期进球和最可能比分。</p>
    </div>

    <div class="quick-pick">
      <span class="muted" style="align-self:center;">焦点对决：</span>
      ${[
        ['ESP', 'ARG', '西班牙 vs 阿根廷'],
        ['BRA', 'FRA', '巴西 vs 法国'],
        ['ENG', 'GER', '英格兰 vs 德国'],
        ['NED', 'POR', '荷兰 vs 葡萄牙'],
      ].map(([h, a, label]) =>
        `<button class="chip" data-h="${h}" data-a="${a}">${label}</button>`
      ).join('')}
    </div>

    <div class="card">
      <div class="predict-pick">
        <div class="picker">
          <span class="flag-big" id="homeFlag"></span>
          <div class="nm-big" id="homeName"></div>
          <div class="elo-pill" id="homeElo"></div>
          <select class="team-select" id="homeSel">
            ${teams.map(t => `<option value="${t.id}">${t.flag} ${t.nameCn}</option>`).join('')}
          </select>
        </div>
        <div class="vs-big">VS</div>
        <div class="picker">
          <span class="flag-big" id="awayFlag"></span>
          <div class="nm-big" id="awayName"></div>
          <div class="elo-pill" id="awayElo"></div>
          <select class="team-select" id="awaySel">
            ${teams.map(t => `<option value="${t.id}">${t.flag} ${t.nameCn}</option>`).join('')}
          </select>
        </div>
      </div>
    </div>

    <div id="predOut"></div>
  `;

  const homeSel = root.querySelector('#homeSel');
  const awaySel = root.querySelector('#awaySel');
  homeSel.value = homeId;
  awaySel.value = awayId;

  function rerender() {
    homeId = homeSel.value;
    awayId = awaySel.value;
    if (homeId === awayId) { awaySel.value = awayId = teams.find(t => t.id !== homeId).id; }
    drawPick();
    drawPred();
  }

  function drawPick() {
    const h = data.teamMap[homeSel.value];
    const a = data.teamMap[awaySel.value];
    root.querySelector('#homeFlag').textContent = h.flag;
    root.querySelector('#homeName').textContent = h.nameCn;
    root.querySelector('#homeElo').textContent = `Elo ${h.elo} · FIFA排名 ${h.rank}`;
    root.querySelector('#awayFlag').textContent = a.flag;
    root.querySelector('#awayName').textContent = a.nameCn;
    root.querySelector('#awayElo').textContent = `Elo ${a.elo} · FIFA排名 ${a.rank}`;
  }

  function drawPred() {
    const h = data.teamMap[homeSel.value];
    const a = data.teamMap[awaySel.value];
    // 世界杯除东道主外均为中立场；仅当主队是东道主时给主场加成
    const homeAdv = h.host ? 100 : 0;
    const p = predict(h.elo, a.elo, homeAdv);

    const out = root.querySelector('#predOut');

    // 顶部实力对比条
    const totalElo = h.elo + a.elo;
    const homePct = (h.elo / totalElo) * 100;

    // 比分热力图（前 4×4 最常见区域，标注概率）
    let heat = '';
    for (let hh = 0; hh <= 4; hh++) {
      for (let aa = 0; aa <= 4; aa++) {
        const isTop = p.top.some(t => t.h === hh && t.a === aa);
        const prob = (p.grid[hh][aa] * 100).toFixed(1);
        heat += `<div class="score-cell ${isTop ? 'top' : ''}">
          <div class="sc">${hh}-${aa}</div><div class="p">${prob}%</div></div>`;
      }
    }

    // 最可能比分列表
    const topList = p.top.map((t, i) =>
      `<div class="kv"><span>第 ${i + 1} 可能</span><span><b style="font-size:16px;color:var(--accent)">${t.h} - ${t.a}</b> · ${(t.p * 100).toFixed(1)}%</span></div>`
    ).join('');

    out.innerHTML = `
      <div class="card" style="margin-top:16px;">
        <h3>🎯 胜平负概率</h3>
        <div class="probs">
          <div class="prob-box">
            <div class="pct win">${(p.win * 100).toFixed(0)}%</div>
            <div class="lbl">${h.nameCn} 胜</div>
          </div>
          <div class="prob-box">
            <div class="pct draw">${(p.draw * 100).toFixed(0)}%</div>
            <div class="lbl">平局</div>
          </div>
          <div class="prob-box">
            <div class="pct lose">${(p.lose * 100).toFixed(0)}%</div>
            <div class="lbl">${a.nameCn} 胜</div>
          </div>
        </div>
        <div class="prob-bar">
          <div class="seg" style="width:${p.win * 100}%;background:var(--accent)"></div>
          <div class="seg" style="width:${p.draw * 100}%;background:var(--gold)"></div>
          <div class="seg" style="width:${p.lose * 100}%;background:var(--red)"></div>
        </div>
      </div>

      <div class="grid grid-2" style="margin-top:16px;">
        <div class="card">
          <h3>📊 关键数据</h3>
          <div class="kv"><span>主队预期进球 (xG)</span><span style="color:var(--accent)">${p.xg.home.toFixed(2)}</span></div>
          <div class="kv"><span>客队预期进球 (xG)</span><span style="color:var(--accent-2)">${p.xg.away.toFixed(2)}</span></div>
          <div class="kv"><span>预期总进球</span><span>${(p.xg.home + p.xg.away).toFixed(2)}</span></div>
          <div class="kv"><span>最可能比分</span><span style="color:var(--gold);font-weight:800">${p.mostLikely.h} - ${p.mostLikely.a}</span></div>
          <div class="kv"><span>该比分概率</span><span>${(p.mostLikely.p * 100).toFixed(1)}%</span></div>
          <div class="kv"><span>实力对比 (Elo)</span>
            <span>${h.elo} vs ${a.elo} ${h.elo > a.elo ? '(主队占优)' : h.elo < a.elo ? '(客队占优)' : '(势均力敌)'}</span></div>
          <div class="power-meter">
            <div class="a" style="width:${homePct}%"></div>
            <div class="d" style="width:${100 - homePct}%"></div>
          </div>
          ${h.host || a.host ? `<p class="hint">🏟️ 本场含东道主主场加成（+${homeAdv}）。</p>` : ''}
        </div>

        <div class="card">
          <h3>🏆 最可能 Top 比分</h3>
          ${topList}
          <p class="hint">泊松模型给出的概率，参考性强但足球充满不确定性。</p>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>🔥 比分概率热力图（绿框 = Top 6）</h3>
        <div class="scoregrid">${heat}</div>
        <p class="hint">每格 = 该比分的出现概率。颜色越深概率越高。</p>
      </div>
    `;
  }

  homeSel.addEventListener('change', rerender);
  awaySel.addEventListener('change', rerender);
  root.querySelectorAll('.chip').forEach(c =>
    c.addEventListener('click', () => {
      homeSel.value = c.dataset.h;
      awaySel.value = c.dataset.a;
      rerender();
    })
  );

  drawPick();
  drawPred();
}
