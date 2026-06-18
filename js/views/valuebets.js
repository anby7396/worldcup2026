// ===== 价值投注每日建议视图（竞彩版）=====
// 数据源：中国竞彩网 odds-jingcai.json（同步脚本 sync-jingcai.mjs）
// 玩法：胜平负 / 让球 / 比分盘(crs) / 总进球(ttg)
// 面向小额娱乐投注（日预算 ~20 元），预算约束分配。

import { predictEnsemble } from '../model/ensemble.js';
import { jingcaiToConsensus } from '../model/odds.js';
import { findValueBets, findCRSValueBets, findTTGValueBets, allocateBudget } from '../model/valuebet.js';
import { matchMotivation } from '../model/motivation.js';

const SETTINGS_KEY = 'wc2026_valuebet_settings_v3';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

// ISO 时间 → 北京时间（世界杯在美洲，UTC-5/-6，北京时间凌晨/上午）
function bjTime(iso) {
  const d = new Date(iso);
  const b = new Date(d.getTime() + 8 * 3600 * 1000);
  const mo = b.getUTCMonth() + 1, da = b.getUTCDate(), hh = b.getUTCHours();
  const period = hh < 6 ? '凌晨' : hh < 12 ? '上午' : hh < 18 ? '下午' : '晚间';
  return { dateKey: `${b.getUTCFullYear()}-${mo}-${da}`, dateLabel: `${mo}/${da}`, hh, period };
}

// 竞彩 matchDate+matchTime → ISO（北京时间的 matchDate+matchTime 是北京时间，要转成 ISO）
function matchToISO(m) {
  // matchDate: "2026-06-18", matchTime: "10:00:00"（北京时间）
  const iso = `${m.matchDate}T${m.matchTime}+08:00`;
  return iso;
}

function localDateKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

const MARKET_LABELS = { crs: '比分', ttg: '总进球', h2h: '胜平负', spreads: '让球' };

export function renderValuebets(root, data, ctx) {
  let settings = {
    budget: 20,
    strategy: 'proportional',
    period: '上午',
    dateKey: localDateKey(1),
    minEdge: 0.03,
    maxOdds: 15,
    ...loadSettings(),
  };

  root.innerHTML = `
    <div class="view-head">
      <h2>💡 竞彩价值助手</h2>
      <p>竞彩赔率 vs 集成模型，覆盖胜平负 / 让球 / <strong>比分盘</strong> / <strong>总进球</strong>。
        <a href="#" id="vbInfo" style="color:var(--accent)">说明与免责</a></p>
    </div>

    <div class="card vb-disclaimer">
      <strong>⚠️ 免责声明：</strong> 本工具是数学/教育性质，<u>不构成投注建议</u>。
      中国体育彩票只能在实体店购买，不得通过任何非官方渠道购彩。模型有偏差，市场通常更对，请理性。
    </div>

    <div class="card">
      <div class="vb-settings">
        <label>日期：<select id="dateSel"></select></label>
        <label>时段：
          <select id="periodSel">
            <option value="全天">全天</option>
            <option value="上午">上午 06-12</option>
            <option value="下午">下午 12-18</option>
            <option value="晚间">晚间 18-24</option>
            <option value="凌晨">凌晨 00-06</option>
          </select>
        </label>
        <label>日预算：¥<input type="number" id="budget" value="${settings.budget}" min="5" step="5" style="width:64px"></label>
        <label>策略：
          <select id="strategySel">
            <option value="proportional">按价值比例（推荐）</option>
            <option value="concentrated">集中投最高</option>
            <option value="fixed">固定每注 5 元</option>
          </select>
        </label>
      </div>
      <div class="vb-settings" style="margin-top:10px;">
        <label>最小 edge：<input type="number" id="minEdge" value="${(settings.minEdge*100).toFixed(1)}" min="0" step="0.5" style="width:56px">%</label>
        <label>最大赔率：<input type="number" id="maxOdds" value="${settings.maxOdds}" min="2" step="0.5" style="width:56px"></label>
        <button class="ghost-btn" id="recalcBtn">重新计算</button>
      </div>
    </div>

    <div id="vbOut"></div>
  `;

  const $ = sel => root.querySelector(sel);

  // 日期下拉（从竞彩数据里提取有比赛的北京日期）
  const jingcaiMatches = data.oddsJingcai?.matches || [];
  const dateSet = [...new Set(jingcaiMatches.map(m => m.matchDate))].sort();
  const dateSel = $('#dateSel');
  const todayKey = localDateKey(0);
  dateSel.innerHTML = dateSet.map(d => {
    const label = d === todayKey ? `今天 ${d}` : d === localDateKey(1) ? `明天 ${d}` : d;
    return `<option value="${d}">${label}</option>`;
  }).join('');
  if (!dateSet.includes(settings.dateKey)) settings.dateKey = dateSet[0] || todayKey;
  dateSel.value = settings.dateKey;
  $('#periodSel').value = settings.period;
  $('#strategySel').value = settings.strategy;

  function syncSettings() {
    settings.dateKey = dateSel.value;
    settings.period = $('#periodSel').value;
    settings.budget = +$('#budget').value || 20;
    settings.strategy = $('#strategySel').value;
    settings.minEdge = (+$('#minEdge').value || 3) / 100;
    settings.maxOdds = +$('#maxOdds').value || 15;
    saveSettings(settings);
  }

  function draw() {
    syncSettings();
    const out = $('#vbOut');

    if (!jingcaiMatches.length) {
      out.innerHTML = `<div class="card"><h3>📭 暂无竞彩赔率</h3>
        <p>运行同步脚本获取：<code>node scripts/sync-jingcai.mjs</code></p></div>`;
      return;
    }

    // 按日期+时段筛选
    const filtered = jingcaiMatches.filter(m => {
      if (!m.homeId || !m.awayId) return false;
      if (m.matchDate !== settings.dateKey) return false;
      if (settings.period === '全天') return true;
      const t = bjTime(matchToISO(m));
      return t.period === settings.period;
    });

    if (!filtered.length) {
      out.innerHTML = `<div class="card"><h3>🔍 该时段暂无比赛</h3>
        <p>共 ${dateSet.length} 个比赛日，${jingcaiMatches.length} 场。换个日期或时段试试。</p></div>`;
      return;
    }

    // 对每场跑全部玩法的价值识别，分流：kellyPositive → 实际下注；!kellyPositive → 参考信息
    const bettableBets = [];    // kellyPositive，进 allocateBudget
    const infoBets = [];         // edge>0 但 kelly≤0，展示参考但不建议下注
    const vbCfg = { bankroll: 10000, kellyFraction: 1, maxStakePct: 1,
                    minEdge: settings.minEdge, maxOdds: settings.maxOdds };

    for (const m of filtered) {
      const home = data.teamMap[m.homeId], away = data.teamMap[m.awayId];
      // 自动应用动机因子：根据每队当前积分/出线形势调整预测
      const motivation = matchMotivation(data, m.homeId, m.awayId);
      const pred = predictEnsemble(home, away, { data, motivation });
      const consensus = jingcaiToConsensus(m);
      const mCn = { ...m, homeNameCn: m.homeName, awayNameCn: m.awayName };
      const mInfo = { homeName: m.homeName, awayName: m.awayName, homeId: m.homeId, awayId: m.awayId };

      // 胜平负 + 让球（复用 findValueBets，传 consensusOverride）
      for (const b of findValueBets(mCn, pred, vbCfg, consensus).bets)
        (b.kellyPositive !== false ? bettableBets : infoBets).push({ ...b, match: mInfo, commenceTime: matchToISO(m) });

      // 比分盘 + 总进球（分流 kellyPositive）
      for (const b of findCRSValueBets(mCn, pred, consensus, vbCfg))
        (b.kellyPositive ? bettableBets : infoBets).push({ ...b, match: mInfo, commenceTime: matchToISO(m) });
      for (const b of findTTGValueBets(mCn, pred, consensus, vbCfg))
        (b.kellyPositive ? bettableBets : infoBets).push({ ...b, match: mInfo, commenceTime: matchToISO(m) });
    }

    // 预算分配（只用 kellyPositive 的 bet）
    const allocated = allocateBudget(bettableBets, settings.budget, settings.strategy);

    if (!allocated.length && !infoBets.length) {
      out.innerHTML = `<div class="card"><h3>🔍 该时段暂无价值投注</h3>
        <p>可调低"最小 edge"或放宽"最大赔率"再试。</p></div>`;
      return;
    }

    // 按比赛分组
    const byMatch = new Map();
    for (const b of allocated) {
      const key = (b.match.homeId || '') + '-' + (b.match.awayId || '');
      if (!byMatch.has(key)) byMatch.set(key, { match: b.match, commenceTime: b.commenceTime, bets: [] });
      byMatch.get(key).bets.push(b);
    }
    const groups = [...byMatch.values()];

    // 汇总
    const totalStake = allocated.reduce((s, b) => s + b.stake, 0);
    const totalEV = allocated.reduce((s, b) => s + b.stake * (b.modelP * b.marketOdds - 1), 0);
    const fetchedAt = data.oddsJingcai.meta?.fetchedAt
      ? new Date(data.oddsJingcai.meta.fetchedAt).toLocaleString('zh-CN') : '未知';
    const [, dmo, dda] = settings.dateKey.split('-');
    const periodLabel = settings.period === '全天' ? '' : settings.period;

    // 按玩法统计
    const byMarket = {};
    for (const b of allocated) byMarket[b.market] = (byMarket[b.market] || 0) + 1;

    out.innerHTML = `
      <div class="card vb-summary">
        <div class="vb-sum-item">
          <div class="vb-sum-num">${filtered.length}</div>
          <div class="vb-sum-lbl">${dmo}/${dda} ${periodLabel}</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">${allocated.length}</div>
          <div class="vb-sum-lbl">注  ${Object.entries(byMarket).map(([k,v]) => MARKET_LABELS[k]+v).join('·')}</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">¥${totalStake}</div>
          <div class="vb-sum-lbl">/ ¥${settings.budget} 预算</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num" style="color:var(--accent)">¥${totalEV >= 0 ? '+' : ''}${totalEV.toFixed(1)}</div>
          <div class="vb-sum-lbl">预期回报</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">${totalStake > 0 ? (totalEV / totalStake * 100).toFixed(1) : 0}%</div>
          <div class="vb-sum-lbl">预期 ROI</div>
        </div>
        <div class="vb-sum-item" style="flex:1;text-align:right;">
          <div class="vb-sum-lbl">竞彩更新</div>
          <div class="muted" style="font-size:12px">${fetchedAt}</div>
        </div>
      </div>

      <div class="vb-list">
        ${groups.map(g => renderMatchCard(g)).join('')}
      </div>

      ${infoBets.length ? renderInfoSection(infoBets) : ''}
    `;
  }

  function renderMatchCard(g) {
    const t = bjTime(g.commenceTime);
    return `
      <div class="card vb-match">
        <div class="vb-match-head">
          <span class="vb-time">${t.dateLabel} ${String(t.hh).padStart(2,'0')}:00 ${t.period}</span>
          <strong>${g.match.homeName} <span class="muted">vs</span> ${g.match.awayName}</strong>
          <span class="vb-bet-count">${g.bets.length} 注</span>
        </div>
        <div class="vb-bets">
          ${g.bets.map(b => renderBetRow(b)).join('')}
        </div>
      </div>
    `;
  }

  function renderBetRow(b) {
    const riskClass = `risk-${b.risk}`;
    const riskLabel = b.risk === 'low' ? '低风险' : b.risk === 'medium' ? '中风险' : '高风险';
    const edgeColor = b.edge >= 0.1 ? 'var(--red)' : b.edge >= 0.05 ? 'var(--gold)' : 'var(--accent)';
    const mktLabel = MARKET_LABELS[b.market] || b.market;
    const mktTag = `<span class="vb-mkt-tag">${mktLabel}</span>`;
    return `
      <div class="vb-bet ${riskClass}">
        <div class="vb-bet-main">
          <div class="vb-bet-name">${b.name} ${mktTag}</div>
          <div class="vb-bet-meta">
            <span>市场 ${(b.marketP * 100).toFixed(0)}%</span>
            <span class="muted">→</span>
            <span style="color:var(--accent)">模型 ${(b.modelP * 100).toFixed(0)}%</span>
            <span class="muted">@ ${b.marketOdds.toFixed(2)}</span>
          </div>
        </div>
        <div class="vb-bet-edge" style="color:${edgeColor};font-weight:800">
          +${(b.edge * 100).toFixed(1)}%
        </div>
        <div class="vb-bet-stake">
          <div class="vb-stake-amt">¥${b.stake}</div>
          <div class="vb-stake-pct muted">${(b.stakePct * 100).toFixed(0)}% 预算</div>
        </div>
        <div class="vb-bet-ev">
          <div class="vb-ev-amt">+¥${(b.stake * (b.modelP * b.marketOdds - 1)).toFixed(1)}</div>
          <div class="muted" style="font-size:11px">${riskLabel}</div>
        </div>
      </div>
    `;
  }

  // 参考信息区：edge>0 但 kelly≤0（竞彩抽水高，模型优势不够抵消）
  function renderInfoSection(infoBets) {
    const byM = new Map();
    for (const b of infoBets) {
      const key = (b.match.homeId || '') + '-' + (b.match.awayId || '');
      if (!byM.has(key)) byM.set(key, { match: b.match, commenceTime: b.commenceTime, bets: [] });
      byM.get(key).bets.push(b);
    }
    const cards = [...byM.values()].map(g => {
      const t = bjTime(g.commenceTime);
      const rows = g.bets.map(b => {
        const mktLabel = MARKET_LABELS[b.market] || b.market;
        return `<div class="vb-info-row">
          <span class="vb-info-mkt">${mktLabel}</span>
          <span class="vb-info-name">${b.name}</span>
          <span class="vb-info-comp">
            <span>模型 ${(b.modelP*100).toFixed(0)}%</span>
            <span class="muted">vs</span>
            <span>竞彩 ${(b.marketP*100).toFixed(0)}%</span>
            <span class="muted">@ ${b.marketOdds.toFixed(2)}</span>
          </span>
          <span class="vb-info-edge" style="color:var(--gold)">+${(b.edge*100).toFixed(1)}%</span>
          <span class="muted" style="font-size:11px">赔率不够</span>
        </div>`;
      }).join('');
      return `<div class="vb-info-match">
        <div class="vb-info-head">${t.dateLabel} ${String(t.hh).padStart(2,'0')}:00
          <strong>${g.match.homeName}</strong> <span class="muted">vs</span> <strong>${g.match.awayName}</strong>
          <span class="muted">${g.bets.length} 项被高估</span>
        </div>
        ${rows}
      </div>`;
    }).join('');

    return `<div class="card vb-info-card">
      <h3>📋 参考：模型认为被低估的选项 <span class="muted" style="font-weight:400;font-size:12px">（edge>0 但竞彩赔率抽水高，不建议实际下注）</span></h3>
      ${cards}
    </div>`;
  }

  // 事件
  [dateSel, $('#periodSel'), $('#strategySel'), $('#budget'), $('#minEdge'), $('#maxOdds')]
    .forEach(el => el.addEventListener('change', draw));
  $('#recalcBtn').addEventListener('click', draw);
  $('#vbInfo').addEventListener('click', (e) => {
    e.preventDefault();
    alert([
      '【数据源：中国竞彩】',
      '赔率来自中国竞彩网（sporttery.cn），覆盖胜平负/让球/比分/总进球/半全场。',
      '数据由 sync-jingcai.mjs 同步，低频（每天 1-2 次）个人分析自用。',
      '',
      '【价值投注原理】',
      'edge = 模型概率 / 竞彩隐含概率 - 1，edge > 0 即正期望。',
      '模型已用竞彩数据校准（attack/defense + leagueAvg），主线贴合市场。',
      '',
      '【日预算分配】',
      '• 按价值比例：按 Kelly 权重分到多个高价值投注（分散）',
      '• 集中投最高：全部押 edge 最高的一注（高回报高波动）',
      '• 固定每注 5 元：按 edge 排序投到预算用完',
      '',
      '【比分盘/总进球盘】',
      '比分盘：模型 grid 每个比分 vs 竞彩波胆赔率，找被低估的比分。',
      '总进球：模型 P(总进球=k) vs 竞彩总进球赔率。',
      '',
      '【免责】',
      '本工具不构成投注建议。中国体彩只能实体店购买。',
      '模型有偏差，市场通常更对。理性，量力而行。',
    ].join('\n'));
  });

  draw();
}
