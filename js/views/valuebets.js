// ===== 价值投注每日建议视图 =====
// 按日期+时段筛选比赛 → 集成模型 + 价值识别 → 在"日预算"上按策略分配仓位。
// 面向小额娱乐投注（如每天 20 元）：纯 Kelly 在小预算下每注太小，
// 改用预算约束分配（按比例 / 集中 / 固定每注）。
//
// 设置持久化：预算、策略、日期、时段、edge、赔率上限存 localStorage。

import { predictEnsemble } from '../model/ensemble.js';
import { findValueBets, allocateBudget } from '../model/valuebet.js';

const SETTINGS_KEY = 'wc2026_valuebet_settings_v2';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

// ISO 时间 → 北京时间 { dateKey, dateLabel, hh, period }
function bjTime(iso) {
  const d = new Date(iso);
  const b = new Date(d.getTime() + 8 * 3600 * 1000);   // UTC+8
  const mo = b.getUTCMonth() + 1, da = b.getUTCDate(), hh = b.getUTCHours();
  const period = hh < 6 ? '凌晨' : hh < 12 ? '上午' : hh < 18 ? '下午' : '晚间';
  return { dateKey: `${b.getUTCFullYear()}-${mo}-${da}`, dateLabel: `${mo}/${da}`, hh, period };
}
// 北京时间"今天+offset"的 dateKey（浏览器本地时区=北京时直接用本地）
function localDateKey(offset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

export function renderValuebets(root, data, ctx) {
  let settings = {
    budget: 20,
    strategy: 'proportional',
    period: '上午',
    dateKey: localDateKey(1),    // 默认明天
    minEdge: 0.03,
    maxOdds: 15,
    ...loadSettings(),
  };

  root.innerHTML = `
    <div class="view-head">
      <h2>💡 价值投注助手</h2>
      <p>按日期/时段筛选比赛，集成模型对比市场赔率，在日预算上分配仓位。
        <a href="#" id="vbInfo" style="color:var(--accent)">说明与免责</a></p>
    </div>

    <div class="card vb-disclaimer">
      <strong>⚠️ 免责声明：</strong> 本工具是数学/教育性质，输出基于公开赔率和统计模型，
      <u>不构成实际投注建议</u>。投注在你所在的司法管辖区可能违法，是否下注、下多少，
      完全由你自己决定并自担风险。模型有偏差，市场通常更对，请理性、量力而行。
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
        <label>分配策略：
          <select id="strategySel">
            <option value="proportional">按价值比例（推荐）</option>
            <option value="concentrated">集中投最高</option>
            <option value="fixed">固定每注 5 元</option>
          </select>
        </label>
      </div>
      <div class="vb-settings" style="margin-top:10px;">
        <label>最小 edge：<input type="number" id="minEdge" value="${(settings.minEdge*100).toFixed(1)}" min="0" step="0.5" style="width:56px">%</label>
        <label>最大赔率：<input type="number" id="maxOdds" value="${settings.maxOdds}" min="1.5" step="0.5" style="width:56px"></label>
        <button class="ghost-btn" id="recalcBtn">重新计算</button>
      </div>
    </div>

    <div id="vbOut"></div>
  `;

  const $ = sel => root.querySelector(sel);

  // 填充日期下拉（从赔率数据里实际存在的北京日期）
  const matches = data.odds?.matches || [];
  const dateSet = [...new Set(matches.map(m => bjTime(m.commenceTime).dateKey))];
  dateSet.sort((a, b) => {
    const [ya, ma, da] = a.split('-').map(Number), [yb, mb, db] = b.split('-').map(Number);
    return ya * 10000 + ma * 100 + da - (yb * 10000 + mb * 100 + db);
  });
  const dateSel = $('#dateSel');
  const todayKey = localDateKey(0);
  dateSel.innerHTML = dateSet.map(k => {
    const [, mo, da] = k.split('-');
    const label = k === todayKey ? `今天 ${mo}/${da}` : k === localDateKey(1) ? `明天 ${mo}/${da}` : `${mo}/${da}`;
    return `<option value="${k}">${label}</option>`;
  }).join('');
  // 若默认 dateKey 不在数据里（如无明天比赛），退到第一个日期
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

    if (!matches.length) {
      out.innerHTML = `
        <div class="card">
          <h3>📭 暂无赔率数据</h3>
          <p>需要先跑同步脚本拉取 the-odds-api 数据：</p>
          <pre style="background:var(--bg-soft);padding:12px;border-radius:8px;overflow-x:auto;">
export ODDS_API_KEY=你的key
node scripts/sync-odds.mjs</pre>
          <p class="muted">API key 去 the-odds-api.com 免费注册（500 次/月额度）。</p>
        </div>`;
      return;
    }

    // --- 按日期+时段筛选 ---
    const filtered = matches.filter(m => {
      const t = bjTime(m.commenceTime);
      if (t.dateKey !== settings.dateKey) return false;
      if (settings.period !== '全天' && t.period !== settings.period) return false;
      return true;
    });

    if (!filtered.length) {
      out.innerHTML = `<div class="card"><h3>🔍 该时段暂无比赛</h3>
        <p>换个日期或时段试试。当前数据覆盖 ${dateSet.length} 个比赛日。</p></div>`;
      return;
    }

    // --- 跑预测 + 价值识别（bankroll/kelly 用默认值，stake 会被 allocateBudget 覆盖）---
    // 用 kellyFraction=1, maxStakePct=1 让 kellyRaw 是完整未钳 Kelly，供 proportional 分配
    const vbCfg = { bankroll: 10000, kellyFraction: 1, maxStakePct: 1,
                    minEdge: settings.minEdge, maxOdds: settings.maxOdds };
    const allBets = [];
    for (const m of filtered) {
      const home = m.homeId ? data.teamMap[m.homeId] : null;
      const away = m.awayId ? data.teamMap[m.awayId] : null;
      if (!home || !away) continue;
      const pred = predictEnsemble(home, away, { data });
      const mCn = { ...m, homeNameCn: home.nameCn, awayNameCn: away.nameCn };
      const result = findValueBets(mCn, pred, vbCfg);
      for (const b of result.bets) allBets.push({ ...b, match: result.match, commenceTime: m.commenceTime });
    }

    if (!allBets.length) {
      out.innerHTML = `<div class="card"><h3>🔍 该时段暂无价值投注</h3>
        <p>当前赔率与模型差异都在阈值内。可调低"最小 edge"或放宽"最大赔率"。</p></div>`;
      return;
    }

    // --- 预算分配 ---
    const allocated = allocateBudget(allBets, settings.budget, settings.strategy);
    if (!allocated.length) {
      out.innerHTML = `<div class="card"><h3>💡 预算不足以分配</h3>
        <p>当前候选投注在 ¥${settings.budget} 预算下无法形成有效仓位。试试"集中投最高"策略或提高预算。</p></div>`;
      return;
    }

    // 按比赛分组
    const byMatch = new Map();
    for (const b of allocated) {
      const key = b.match.homeId + '-' + b.match.awayId;
      if (!byMatch.has(key)) byMatch.set(key, { match: b.match, commenceTime: b.commenceTime, bets: [] });
      byMatch.get(key).bets.push(b);
    }
    const groups = [...byMatch.values()];

    // 汇总
    const totalStake = allocated.reduce((s, b) => s + b.stake, 0);
    const totalEV = allocated.reduce((s, b) => {
      // 用模型概率重算 EV（分配后 stake 变了）
      const p = b.modelP, odds = b.marketOdds;
      return s + b.stake * (p * odds - 1);
    }, 0);
    const fetchedAt = data.odds.meta?.fetchedAt
      ? new Date(data.odds.meta.fetchedAt).toLocaleString('zh-CN') : '未知';
    const periodLabel = settings.period === '全天' ? '' : settings.period;
    const [, dmo, dda] = settings.dateKey.split('-');

    out.innerHTML = `
      <div class="card vb-summary">
        <div class="vb-sum-item">
          <div class="vb-sum-num">${filtered.length}</div>
          <div class="vb-sum-lbl">${dmo}/${dda} ${periodLabel}比赛</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">${allocated.length}</div>
          <div class="vb-sum-lbl">个建议投注</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">¥${totalStake}</div>
          <div class="vb-sum-lbl">总下注 / ¥${settings.budget}预算</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num" style="color:var(--accent)">¥${totalEV >= 0 ? '+' : ''}${totalEV.toFixed(1)}</div>
          <div class="vb-sum-lbl">预期回报</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">${(totalEV / totalStake * 100).toFixed(1)}%</div>
          <div class="vb-sum-lbl">预期 ROI</div>
        </div>
        <div class="vb-sum-item" style="flex:1;text-align:right;">
          <div class="vb-sum-lbl">赔率更新</div>
          <div class="muted" style="font-size:12px">${fetchedAt}</div>
        </div>
      </div>

      <div class="vb-list">
        ${groups.map(g => renderMatchCard(g)).join('')}
      </div>
    `;
  }

  function renderMatchCard(g) {
    const t = bjTime(g.commenceTime);
    const time = `${t.dateLabel} ${String(t.hh).padStart(2,'0')}:00`;
    return `
      <div class="card vb-match">
        <div class="vb-match-head">
          <span class="vb-time">${time} ${t.period}</span>
          <strong>${g.match.homeName} <span class="muted">vs</span> ${g.match.awayName}</strong>
          <span class="vb-bet-count">${g.bets.length} 注</span>
        </div>
        <div class="vb-bets">
          ${g.bets.map(b => renderBetRow(b, settings.budget)).join('')}
        </div>
      </div>
    `;
  }

  function renderBetRow(b, budget) {
    const riskClass = `risk-${b.risk}`;
    const riskLabel = b.risk === 'low' ? '低风险' : b.risk === 'medium' ? '中风险' : '高风险';
    const edgeColor = b.edge >= 0.1 ? 'var(--red)' : b.edge >= 0.05 ? 'var(--gold)' : 'var(--accent)';
    return `
      <div class="vb-bet ${riskClass}">
        <div class="vb-bet-main">
          <div class="vb-bet-name">${b.name}</div>
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

  // 事件
  [dateSel, $('#periodSel'), $('#strategySel'), $('#budget'), $('#minEdge'), $('#maxOdds')]
    .forEach(el => el.addEventListener('change', draw));
  $('#recalcBtn').addEventListener('click', draw);
  $('#vbInfo').addEventListener('click', (e) => {
    e.preventDefault();
    alert([
      '【价值投注原理】',
      'edge = 模型概率 / 市场隐含概率 - 1，edge > 0 即正期望。',
      '',
      '【日预算分配】（小额投注专用）',
      '纯 Kelly 在 20 元下每注仅 ¥1-2（低于最小下注额），所以改用预算分配：',
      '• 按价值比例：按各投注的 Kelly 权重分预算，分散到多个高价值投注（单注≤50%）',
      '• 集中投最高：全部押 edge 最高的一注，高回报高波动',
      '• 固定每注 5 元：按 edge 从高到低，投到预算用完',
      '',
      '【模型校准】',
      'attack/defense + 总进球基准已用市场赔率校准（scripts/calibrate.mjs），',
      '主线贴合市场，只在市场定价不充分处（大小球细节）产生 edge。',
      '',
      '【风控】',
      '最大赔率默认 15：过滤极端薄市场（弱队爆冷 @50+），',
      '这些 Kelly 极小但 edge 被放大成虚假信号。',
      '',
      '【免责】',
      '本工具不构成投注建议。模型有偏差，市场通常更对。理性，量力而行。',
    ].join('\n'));
  });

  draw();
}
