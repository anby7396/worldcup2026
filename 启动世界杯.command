#!/bin/bash
# ===== 双击启动 2026 世界杯工具 =====
cd "$(dirname "$0")"

echo "============================================"
echo "  🏆 2026 世界杯 · 赛程 + 预测助手"
echo "============================================"
echo ""

# 如果 8765 端口已被占用，先停掉旧的
lsof -ti:8765 >/dev/null 2>&1 && {
  echo "检测到旧的服务进程，正在重启…"
  lsof -ti:8765 | xargs kill 2>/dev/null
  sleep 1
}

# 后台启动本地服务器
python3 -m http.server 8765 >/dev/null 2>&1 &
SRV=$!
sleep 1.5

# 打开浏览器
open "http://localhost:8765"
echo "✅ 浏览器已打开：http://localhost:8765"
echo ""
echo "📊 比分由系统定时自动同步（每小时），无需手动操作。"
echo ""
echo "⚠️  这个窗口请保持打开（关掉它网页就停了）。"
echo "   看完后直接关掉此窗口即可。"
echo ""
echo "按 Ctrl+C 或关闭窗口退出…"
echo ""

# 前台等待服务器（窗口关了服务器随之停止）
wait $SRV
