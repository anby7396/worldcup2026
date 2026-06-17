// ===== 应用主入口 =====
import { loadData, clearResults } from './data.js';
import { renderFormat } from './views/format.js';
import { renderSchedule } from './views/schedule.js';
import { renderGroups } from './views/groups.js';
import { renderBracket } from './views/bracket.js';
import { renderPredictor } from './views/predictor.js';
import { renderValuebets } from './views/valuebets.js';

let data = null;
let currentView = 'format';

const views = {
  format: renderFormat,
  schedule: renderSchedule,
  groups: renderGroups,
  bracket: renderBracket,
  predictor: renderPredictor,
  valuebets: renderValuebets,
};

// 解析 hash：支持 "predictor" 或 "predictor?h=ESP&a=ARG"（用于一键预测）
function parseHash() {
  const raw = location.hash.slice(1);
  const [view, query] = raw.split('?');
  const params = {};
  if (query) query.split('&').forEach(kv => {
    const [k, v] = kv.split('=');
    if (k) params[k] = decodeURIComponent(v || '');
  });
  return { view, params };
}

async function boot() {
  try {
    data = await loadData();
  } catch (e) {
    document.getElementById('app').innerHTML =
      `<div class="card"><h3>⚠️ 加载失败</h3><p>${e.message}</p>
       <p class="muted">提示：需要用本地服务器打开（见 README）。直接双击 html 打开时，fetch 加载 JSON 会被浏览器拦截。</p></div>`;
    return;
  }

  // Tab 切换
  document.getElementById('tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    location.hash = btn.dataset.view;
  });

  // 浏览器前进/后退 / 带 hash 的链接（含预测快捷入口）
  window.addEventListener('hashchange', () => {
    const { view, params } = parseHash();
    if (views[view]) switchView(view, params);
  });

  // 重置比分
  document.getElementById('resetBtn').addEventListener('click', async () => {
    if (!confirm('确定清空所有已录入的比分？此操作不可撤销。')) return;
    clearResults();
    location.reload();
  });

  // 初始视图：优先用 URL hash，否则默认赛制页
  const { view, params } = parseHash();
  switchView(views[view] ? view : 'format', params);
}

function switchView(name, params) {
  currentView = name;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.view === name)
  );
  const app = document.getElementById('app');
  app.scrollTop = 0;
  app.innerHTML = '';
  views[name](app, data, { refresh: () => switchView(name, params), params: params || {} });
}

boot();
