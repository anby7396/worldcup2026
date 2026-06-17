// ===== 价值投注每日建议视图 =====
// 对每场有赔率的比赛跑集成模型 + 价值识别 + Kelly 仓位，
// 输出按价值排序的候选下注。
//
// 设置持久化：bankroll、Kelly 分数、最小 edge 存 localStorage。

import { predictEnsemble } from '../model/ensemble.js';
import { findValueBets, DEFAULTS } from '../model/valuebet.js';

const SETTINGS_KEY = 'wc2026_valuebet_settings_v1';

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'); }
  catch { return {}; }
}
function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

export function renderValuebets(root, data, ctx) {
  let settings = {
    bankroll: 1000,
    kellyFraction: 0.25,
    minEdge: 0.03,
    maxStakePct: 0.05,
    ...loadSettings(),
  };

  root.innerHTML = `
    <div class="view-head">
      <h2>💡 价值投注助手</h2>
      <p>对比集成模型概率与市场赔率（the-odds-api），用分数 Kelly 找出正期望投注。
        <a href="#" id="vbInfo" style="color:var(--accent)">说明与免责</a></p>
    </div>

    <div class="card vb-disclaimer">
      <strong>⚠️ 免责声明：</strong> 本工具是数学/教育性质，输出基于公开赔率和统计模型，
      <u>不构成实际投注建议</u>。投注在你所在的司法管辖区可能违法，是否下注、下多少，
      完全由你自己决定并自担风险。模型有偏差，市场通常更对，请理性。
    </div>

    <div class="card">
      <div class="vb-settings">
        <label>本金 (¥/元)：<input type="number" id="bankroll" value="${settings.bankroll}" min="100" step="100"></label>
        <label>Kelly 分数：
          <select id="kellyFrac">
            <option value="0.125">1/8（极保守）</option>
            <option value="0.25">1/4（推荐）</option>
            <option value="0.5">1/2（进取）</option>
            <option value="1">完整 Kelly（高风险）</option>
          </select>
        </label>
        <label>最小 edge：<input type="number" id="minEdge" value="${(settings.minEdge*100).toFixed(1)}" min="0" step="0.5" style="width:60px">%</label>
        <button class="ghost-btn" id="recalcBtn">重新计算</button>
      </div>
    </div>

    <div id="vbOut"></div>
  `;

  const $ = sel => root.querySelector(sel);
  $('#kellyFrac').value = settings.kellyFraction;

  function rerender() {
    // 同步设置回内存 + 持久化
    settings.bankroll = +$('#bankroll').value || 1000;
    settings.kellyFraction = +$('#kellyFrac').value;
    settings.minEdge = (+$('#minEdge').value || 3) / 100;
    saveSettings(settings);
    draw();
  }

  function draw() {
    const out = $('#vbOut');
    const matches = data.odds?.matches || [];

    if (!matches.length) {
      out.innerHTML = `
        <div class="card">
          <h3>📭 暂无赔率数据</h3>
          <p>需要先跑同步脚本拉取 the-odds-api 数据：</p>
          <pre style="background:var(--bg-soft);padding:12px;border-radius:8px;overflow-x:auto;">
export ODDS_API_KEY=你的key
node scripts/sync-odds.mjs</pre>
          <p class="muted">API key 去 the-odds-api.com 免费注册（500 次/月额度）。
            世界杯开赛前才有该赛事的赔率数据。</p>
        </div>`;
      return;
    }

    // 对每场比赛跑预测 + 价值识别
    const allBets = [];
    for (const m of matches) {
      const home = m.homeId ? data.teamMap[m.homeId] : null;
      const away = m.awayId ? data.teamMap[m.awayId] : null;
      if (!home || !away) continue;   // 队名未匹配，跳过
      const pred = predictEnsemble(home, away, { data });
      const result = findValueBets(m, pred, settings);
      if (result.bets.length) allBets.push(result);
    }

    if (!allBets.length) {
      out.innerHTML = `
        <div class="card">
          <h3>🔍 暂无价值投注</h3>
          <p>当前赔率与模型概率差异都在阈值内。可以调低"最小 edge"再试。</p>
        </div>`;
      return;
    }

    // 汇总
    const totalStake = allBets.reduce((s, r) => s + r.summary.totalStake, 0);
    const totalEV = allBets.reduce((s, r) => s + r.summary.expectedReturn, 0);
    const fetchedAt = data.odds.meta?.fetchedAt
      ? new Date(data.odds.meta.fetchedAt).toLocaleString('zh-CN') : '未知';

    out.innerHTML = `
      <div class="card vb-summary">
        <div class="vb-sum-item">
          <div class="vb-sum-num">${allBets.length}</div>
          <div class="vb-sum-lbl">场比赛有候选</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">${allBets.reduce((n, r) => n + r.bets.length, 0)}</div>
          <div class="vb-sum-lbl">个价值投注</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">¥${totalStake.toFixed(0)}</div>
          <div class="vb-sum-lbl">总建议下注</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num" style="color:var(--accent)">¥${totalEV.toFixed(0)}</div>
          <div class="vb-sum-lbl">预期总回报</div>
        </div>
        <div class="vb-sum-item">
          <div class="vb-sum-num">${(totalEV / totalStake * 100).toFixed(1)}%</div>
          <div class="vb-sum-lbl">综合 ROI</div>
        </div>
        <div class="vb-sum-item" style="flex:1;text-align:right;">
          <div class="vb-sum-lbl">赔率更新</div>
          <div class="muted" style="font-size:12px">${fetchedAt}</div>
        </div>
      </div>

      <div class="vb-list">
        ${allBets.map(r => renderMatchCard(r)).join('')}
      </div>
    `;
  }

  function renderMatchCard(r) {
    const time = new Date(r.match.commenceTime).toLocaleString('zh-CN',
      { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `
      <div class="card vb-match">
        <div class="vb-match-head">
          <span class="vb-time">${time}</span>
          <strong>${r.match.homeName} <span class="muted">vs</span> ${r.match.awayName}</strong>
          <span class="vb-bet-count">${r.bets.length} 个候选</span>
        </div>
        <div class="vb-bets">
          ${r.bets.map(b => renderBetRow(b, settings.bankroll)).join('')}
        </div>
      </div>
    `;
  }

  function renderBetRow(b, bankroll) {
    const riskClass = `risk-${b.risk}`;
    const riskLabel = b.risk === 'low' ? '低风险' : b.risk === 'medium' ? '中风险' : '高风险';
    const edgeColor = b.edge >= 0.1 ? 'var(--red)' : b.edge >= 0.05 ? 'var(--gold)' : 'var(--accent)';
    return `
      <div class="vb-bet ${riskClass}">
        <div class="vb-bet-main">
          <div class="vb-bet-name">${b.name}</div>
          <div class="vb-bet-meta">
            <span>市场 ${(b.marketP * 100).toFixed(1)}%</span>
            <span class="muted">→</span>
            <span style="color:var(--accent)">模型 ${(b.modelP * 100).toFixed(1)}%</span>
            <span class="muted">@ ${b.marketOdds.toFixed(2)}</span>
          </div>
        </div>
        <div class="vb-bet-edge" style="color:${edgeColor};font-weight:800">
          +${(b.edge * 100).toFixed(1)}%
        </div>
        <div class="vb-bet-stake">
          <div class="vb-stake-amt">¥${b.stake}</div>
          <div class="vb-stake-pct" class="muted">${(b.stakePct * 100).toFixed(2)}%</div>
        </div>
        <div class="vb-bet-ev">
          <div class="vb-ev-amt">¥${b.expectedValue >= 0 ? '+' : ''}${b.expectedValue.toFixed(0)}</div>
          <div class="muted" style="font-size:11px">${riskLabel}</div>
        </div>
      </div>
    `;
  }

  // 事件
  $('#recalcBtn').addEventListener('click', rerender);
  $('#vbInfo').addEventListener('click', (e) => {
    e.preventDefault();
    alert([
      '【价值投注原理】',
      '',
      'edge = 模型概率 / 市场隐含概率 - 1',
      'edge > 0 表示模型认为该结果发生概率高于市场定价，存在正期望值。',
      '',
      '【Kelly 公式】',
      'f* = (b·p - q) / b，其中 b=赔率-1，p=模型概率，q=1-p',
      'f* 是最大化长期资金增长率的最优下注比例。',
      '',
      '【分数 Kelly】',
      '完整 Kelly 对概率估计误差极敏感（差 5% 可能差 50% 仓位）。',
      '业界默认用 1/4 Kelly 折扣，长期增长率打 75% 但回撤显著降低。',
      '',
      '【市场数据来源】',
      'the-odds-api 聚合 Pinnacle、Bet365、DraftKings 等多家 bookmaker。',
      '去 vigorish（庄家抽水）用 Shin method（1993），比简单归一化更准。',
      '',
      '【免责声明】',
      '本工具不构成投注建议。模型有偏差，市场通常更对。',
      '请理性，量力而行，遵守当地法律。',
    ].join('\n'));
  });

  draw();
}
