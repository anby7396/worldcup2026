#!/usr/bin/env node
// ===== 定时自动同步安装器（macOS launchd）=====
// 用法：
//   node scripts/autosync.mjs install     安装（每小时自动跑 sync.mjs）
//   node scripts/autosync.mjs uninstall   卸载
//   node scripts/autosync.mjs status      查看状态与最近日志
//
// 自动探测 node 绝对路径与项目路径，处理中文目录、nvm 等，无需手动改配置。
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { execSync } from 'child_process';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const NODE_BIN = process.execPath;                       // 当前 node 的绝对路径
const SYNC_SCRIPT = path.join(PROJECT_ROOT, 'sync.mjs');
const LABEL = 'com.worldcup2026.sync';
const PLIST = path.join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`);
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const UID = execSync('id -u').toString().trim();

const cmd = process.argv[2] || 'status';

function buildPlist() {
  const spec = {
    Label: LABEL,
    ProgramArguments: [NODE_BIN, SYNC_SCRIPT],
    WorkingDirectory: PROJECT_ROOT,
    // 每小时第 17 分钟跑一次（避开整点拥堵）+ 每次登录/加载时也跑一次保证新鲜
    StartCalendarInterval: { Minute: 17 },
    RunAtLoad: true,
    StandardOutPath: path.join(LOG_DIR, 'sync.log'),
    StandardErrorPath: path.join(LOG_DIR, 'sync.err'),
    EnvironmentVariables: { PATH: `${path.dirname(NODE_BIN)}:/usr/bin:/bin:/usr/local/bin` },
  };
  // 手写 plist（避免依赖 plist 库）
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${esc(spec.Label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${esc(spec.ProgramArguments[0])}</string>
    <string>${esc(spec.ProgramArguments[1])}</string>
  </array>
  <key>WorkingDirectory</key><string>${esc(spec.WorkingDirectory)}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Minute</key><integer>17</integer></dict>
  <key>RunAtLoad</key><${spec.RunAtLoad}/>
  <key>StandardOutPath</key><string>${esc(spec.StandardOutPath)}</string>
  <key>StandardErrorPath</key><string>${esc(spec.StandardErrorPath)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${esc(spec.EnvironmentVariables.PATH)}</string></dict>
</dict>
</plist>`;
}

function load() {
  try { execSync(`launchctl unload "${PLIST}" 2>/dev/null`); } catch {}
  execSync(`launchctl load "${PLIST}"`);
}

function isLoaded() {
  try {
    const out = execSync(`launchctl list ${LABEL} 2>/dev/null`).toString();
    return out.includes('Label');
  } catch { return false; }
}

function install() {
  mkdirSync(LOG_DIR, { recursive: true });
  mkdirSync(path.dirname(PLIST), { recursive: true });
  writeFileSync(PLIST, buildPlist());
  load();
  console.log('✅ 已安装定时同步（launchd）');
  console.log(`   Node:    ${NODE_BIN}`);
  console.log(`   脚本:    ${SYNC_SCRIPT}`);
  console.log(`   频率:    每小时第 17 分钟 + 每次登录时`);
  console.log(`   日志:    ${LOG_DIR}/sync.log`);
  console.log(`   配置:    ${PLIST}`);
  console.log('\n   现在立即触发一次同步以验证…');
  try {
    execSync(`launchctl start ${LABEL}`);
    console.log('   已触发（查看 logs/sync.log 确认结果）');
  } catch (e) { console.log('   触发失败，可手动跑 node sync.mjs 测试'); }
  console.log('\n💡 之后每小时自动同步。打开网页刷新即可看最新比分。');
}

function uninstall() {
  try { execSync(`launchctl unload "${PLIST}" 2>/dev/null`); } catch {}
  if (existsSync(PLIST)) { rmSync(PLIST); console.log('✅ 已卸载定时同步（plist 已删除）'); }
  else console.log('（未发现已安装的定时任务）');
}

function status() {
  if (!existsSync(PLIST)) { console.log('⛔ 未安装定时同步。运行: node scripts/autosync.mjs install'); return; }
  console.log(`已安装: ${isLoaded() ? '✅ 运行中' : '⚠️ 已注册但未加载'}`);
  console.log(`配置:   ${PLIST}`);
  const log = path.join(LOG_DIR, 'sync.log');
  if (existsSync(log)) {
    const tail = readFileSync(log, 'utf8').trimEnd().split('\n').slice(-8).join('\n');
    console.log(`\n最近日志 (${log}):\n${tail}`);
  } else {
    console.log('\n（尚无运行日志，等待首次触发）');
  }
}

if (cmd === 'install') install();
else if (cmd === 'uninstall') uninstall();
else status();
