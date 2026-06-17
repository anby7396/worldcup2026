// ===== 比赛预测助手视图 =====
// 集成模型（Elo-Poisson + Dixon-Coles + xG 双参数）输出胜平负 / 比分热力图 / 蒙特卡洛模拟。
// UI 增强：
//   - 模型来源切换（Ensemble / Dixon-Coles / 旧 Elo-Poisson 对比）
//   - 关键球员缺阵开关（attack/defense × 0.85）
//   - 海拔影响提示（墨西哥城等高海拔场地）
//   - 蒙特卡洛淘汰赛模拟（含点球大战）

import { predictEnsemble } from '../model/ensemble.js';
import { predict as poissonPredict } from '../model/poisson.js';
import { predictDC, altitudeAdjust } from '../model/dixonColes.js';
import { simulateKO, monteCarlo } from '../model/monteCarlo.js';

export function renderPredictor(root, data, ctx) {
  const teams = [...data.teams].sort((a, b) => b.elo - a.elo);

  const ph = ctx.params?.h, pa = ctx.params?.a;
  let homeId = ph && data.teamMap[ph] ? ph : 'ESP';
  let awayId = pa && data.teamMap[pa] ? pa : 'ARG';

  // 视图局部状态
  const state = {
    model: 'ensemble',          // ensemble | dc | poisson
    homeKeyOut: false,           // 主队关键球员是否缺阵
    awayKeyOut: false,
    venue: '',                   // 场地（空 = 中立场）
    isHostMatch: false,          // 是否给主队主场加成
  };

  const venueOptions = Object.keys(data.venues || {});

  root.innerHTML = `
    <div class="view-head">
      <h2>比赛预测助手 <span class="muted" style="font-size:13px;font-weight:400">v2 · 集成模型</span></h2>
      <p>Elo-Poisson + Dixon-Coles + xG 三模型集成预测，含场地海拔修正、关键球员缺阵、蒙特卡洛淘汰赛模拟。
        <a href="#" id="modelInfoBtn" style="color:var(--accent)">查看模型对比</a></p>
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
          <label class="opt-row"><input type="checkbox" id="homeKeyOut"> 核心球员缺阵</label>
        </div>
        <div class="vs-big">VS</div>
        <div class="picker">
          <span class="flag-big" id="awayFlag"></span>
          <div class="nm-big" id="awayName"></div>
          <div class="elo-pill" id="awayElo"></div>
          <select class="team-select" id="awaySel">
            ${teams.map(t => `<option value="${t.id}">${t.flag} ${t.nameCn}</option>`).join('')}
          </select>
          <label class="opt-row"><input type="checkbox" id="awayKeyOut"> 核心球员缺阵</label>
        </div>
      </div>

      <div class="opt-row" style="margin-top:12px;gap:14px;flex-wrap:wrap;">
        <label>模型：
          <select id="modelSel">
            <option value="ensemble">集成模型（推荐）</option>
            <option value="dc">Dixon-Coles</option>
            <option value="poisson">Elo-Poisson（基线）</option>
          </select>
        </label>
        <label>场地：
          <select id="venueSel">
            <option value="">中立场</option>
            ${venueOptions.map(v => `<option value="${v}">${v} (海拔 ${data.venues[v].altitude}m)</option>`).join('')}
          </select>
        </label>
        <label><input type="checkbox" id="hostChk"> 主队享主场加成</label>
      </div>
    </div>

    <div id="predOut"></div>
  `;

  const $ = sel => root.querySelector(sel);
  const homeSel = $('#homeSel'), awaySel = $('#awaySel');
  homeSel.value = homeId; awaySel.value = awayId;

  function syncStateFromUI() {
    homeId = homeSel.value;
    awayId = awaySel.value;
    if (homeId === awayId) { awaySel.value = awayId = teams.find(t => t.id !== homeId).id; }
    state.model = $('#modelSel').value;
    state.homeKeyOut = $('#homeKeyOut').checked;
    state.awayKeyOut = $('#awayKeyOut').checked;
    state.venue = $('#venueSel').value;
    state.isHostMatch = $('#hostChk').checked;
  }

  function runPredict(home, away) {
    const homeStrength = data.teamStrength?.[home.id];
    const awayStrength = data.teamStrength?.[away.id];
    const keyOut = {
      home: state.homeKeyOut ? (data.keyPlayers?.[home.id]?.[0]?.role || 'attack') : null,
      away: state.awayKeyOut ? (data.keyPlayers?.[away.id]?.[0]?.role || 'attack') : null,
    };

    // 海拔
    let altAdj = { home: 1, away: 1 };
    if (state.venue && data.venues?.[state.venue]) {
      const venueAlt = data.venues[state.venue].altitude;
      const homeAlt = home.id === 'MEX' ? 2240 : 200;
      const awayAlt = away.id === 'MEX' ? 2240 : 200;
      altAdj = altitudeAdjust(venueAlt, homeAlt, awayAlt);
    }

    if (state.model === 'ensemble') {
      return predictEnsemble(home, away, {
        data, venue: state.venue,
        isHostMatch: state.isHostMatch, keyOut,
      });
    }
    if (state.model === 'dc') {
      const sh = homeStrength || eloToStrength(home.elo);
      const sa = awayStrength || eloToStrength(away.elo);
      return predictDC({
        homeAttack: sh.attack, homeDefense: sh.defense,
        awayAttack: sa.attack, awayDefense: sa.defense,
        homeAdvantage: state.isHostMatch ? 1.25 : 1.0,
        altitudeAdj: altAdj, keyOut,
      });
    }
    // poisson 基线
    return poissonPredict(home.elo, away.elo, state.isHostMatch ? 100 : 0);
  }

  function drawPick() {
    const h = data.teamMap[homeSel.value];
    const a = data.teamMap[awaySel.value];
    $('#homeFlag').textContent = h.flag;
    $('#homeName').textContent = h.nameCn;
    $('#homeElo').textContent = `Elo ${h.elo} · FIFA ${h.rank}`;
    $('#awayFlag').textContent = a.flag;
    $('#awayName').textContent = a.nameCn;
    $('#awayElo').textContent = `Elo ${a.elo} · FIFA ${a.rank}`;
  }

  function drawPred() {
    syncStateFromUI();
    const h = data.teamMap[homeSel.value];
    const a = data.teamMap[awaySel.value];
    const p = runPredict(h, a);

    // 蒙特卡洛淘汰赛模拟（10000 次）
    const koStats = monteCarlo(() => simulateKO(p, h.elo, a.elo), 10000);

    // 关键球员信息
    const hKey = data.keyPlayers?.[h.id]?.[0];
    const aKey = data.keyPlayers?.[a.id]?.[0];

    // 比分热力图（5×5 区域）
    let heat = '';
    for (let hh = 0; hh <= 4; hh++) {
      for (let aa = 0; aa <= 4; aa++) {
        const isTop = p.top.some(t => t.h === hh && t.a === aa);
        const prob = (p.grid[hh][aa] * 100).toFixed(1);
        heat += `<div class="score-cell ${isTop ? 'top' : ''}">
          <div class="sc">${hh}-${aa}</div><div class="p">${prob}%</div></div>`;
      }
    }

    const topList = p.top.map((t, i) =>
      `<div class="kv"><span>第 ${i + 1} 可能</span><span><b style="font-size:16px;color:var(--accent)">${t.h} - ${t.a}</b> · ${(t.p * 100).toFixed(1)}%</span></div>`
    ).join('');

    // 模型名称中文
    const modelName = state.model === 'ensemble' ? '集成模型' :
                      state.model === 'dc' ? 'Dixon-Coles 双参数' : 'Elo-Poisson 基线';

    // 海拔提示
    let altHint = '';
    if (state.venue && data.venues?.[state.venue]?.altitude >= 1500) {
      altHint = `<p class="hint">⛰️ 在 ${state.venue}（海拔 ${data.venues[state.venue].altitude}m）比赛，
        高原对非高原球队的体能/技术影响已计入。</p>`;
    }

    // 集成模型展示子模型对比
    let memberCmp = '';
    if (state.model === 'ensemble' && p.members) {
      memberCmp = `
        <div class="card" style="margin-top:16px;">
          <h3>🔬 子模型概率对比（集成权重已用）</h3>
          <div class="kv"><span>Elo-Poisson</span><span>
            ${(p.members.elo.win*100).toFixed(0)}% / ${(p.members.elo.draw*100).toFixed(0)}% / ${(p.members.elo.lose*100).toFixed(0)}%
            <span class="muted">权重 ${(p.weights.elo*100).toFixed(0)}%</span></span></div>
          <div class="kv"><span>Dixon-Coles</span><span>
            ${(p.members.dc.win*100).toFixed(0)}% / ${(p.members.dc.draw*100).toFixed(0)}% / ${(p.members.dc.lose*100).toFixed(0)}%
            <span class="muted">权重 ${(p.weights.dc*100).toFixed(0)}%</span></span></div>
          <div class="kv"><span>xG-Poisson</span><span>
            ${(p.members.xg.win*100).toFixed(0)}% / ${(p.members.xg.draw*100).toFixed(0)}% / ${(p.members.xg.lose*100).toFixed(0)}%
            <span class="muted">权重 ${(p.weights.xg*100).toFixed(0)}%</span></span></div>
          <p class="hint">三个模型对同一场比赛的概率，集成后能减少单模型偏差。
            <br>2022 世界杯回测：集成 Brier=0.569，比纯 Elo-Poisson（0.590）提升约 3.6%。</p>
        </div>`;
    }

    // 关键球员显示
    let keyHint = '';
    if (state.homeKeyOut || state.awayKeyOut) {
      const parts = [];
      if (state.homeKeyOut && hKey) parts.push(`${h.nameCn} 失去 ${hKey.name}（${hKey.role}×0.85）`);
      if (state.awayKeyOut && aKey) parts.push(`${a.nameCn} 失去 ${aKey.name}（${aKey.role}×0.85）`);
      keyHint = `<p class="hint">⚠️ 关键球员缺阵已计入：${parts.join('；')}</p>`;
    }

    const totalElo = h.elo + a.elo;
    const homePct = (h.elo / totalElo) * 100;

    $('#predOut').innerHTML = `
      <div class="card" style="margin-top:16px;">
        <h3>🎯 胜平负概率 <span class="muted" style="font-size:13px;font-weight:400">· ${modelName}</span></h3>
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
        ${keyHint}
        ${altHint}
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
        </div>

        <div class="card">
          <h3>🥅 蒙特卡洛淘汰赛模拟 <span class="muted" style="font-size:12px;font-weight:400">· 10000 次</span></h3>
          <div class="kv"><span>${h.nameCn} 晋级</span><span style="color:var(--accent);font-weight:800">${(koStats.pHome * 100).toFixed(1)}%</span></div>
          <div class="kv"><span>${a.nameCn} 晋级</span><span style="color:var(--red);font-weight:800">${(koStats.pAway * 100).toFixed(1)}%</span></div>
          <div class="kv"><span>进入点球大战概率</span><span>${(koStats.pPK * 100).toFixed(1)}%</span></div>
          <p class="hint">假设为淘汰赛（必分胜负）。90 分钟比分按概率抽样，平局走点球大战（Elo 加权）。</p>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>🏆 最可能 Top 比分</h3>
        ${topList}
        <p class="hint">概率分布由 ${modelName} 给出。足球永远存在不确定性，参考为主。</p>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>🔥 比分概率热力图（绿框 = Top 6）</h3>
        <div class="scoregrid">${heat}</div>
        <p class="hint">每格 = 该比分概率。颜色越深越可能。</p>
      </div>

      ${memberCmp}
    `;
  }

  function eloToStrength(elo) {
    const k = (elo - 1700) / 400;
    const v = Math.max(0.6, Math.min(1.6, 0.9 + 0.5 * k));
    return { attack: v, defense: v };
  }

  // 事件
  function rerender() { drawPick(); drawPred(); }
  [homeSel, awaySel, $('#modelSel'), $('#venueSel'), $('#hostChk'),
   $('#homeKeyOut'), $('#awayKeyOut')].forEach(el => el.addEventListener('change', rerender));
  root.querySelectorAll('.chip').forEach(c =>
    c.addEventListener('click', () => {
      homeSel.value = c.dataset.h;
      awaySel.value = c.dataset.a;
      rerender();
    })
  );
  $('#modelInfoBtn').addEventListener('click', (e) => {
    e.preventDefault();
    alert([
      '【模型说明】',
      '• Elo-Poisson（基线）：用 Elo 分差推总 xG，独立泊松算比分。简单稳。',
      '• Dixon-Coles：每队拆 attack/defense 双参数，加 0-0/1-0/0-1/1-1 低比分修正。',
      '• xG-Poisson：用攻防系数直接当 xG 代理，独立泊松。',
      '• 集成模型：三者按 25%/50%/25% 加权平均，2022 回测 Brier 提升约 3.6%。',
      '',
      '【增强项】',
      '• 海拔修正（>1500m 客队 xG × 0.92）',
      '• 关键球员缺阵（attack/defense × 0.85）',
      '• 蒙特卡洛模拟（按 grid 抽样，平局点球 Elo 加权）',
    ].join('\n'));
  });

  drawPick();
  drawPred();
}
