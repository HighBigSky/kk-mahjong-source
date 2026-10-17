#!/usr/bin/env bash
# KK麻将 · 一键部署（Ubuntu 24.04 / Debian 12，阿里云轻量香港实测路径）
# 用法：把整个项目目录上传到服务器后，在项目根目录执行  sudo bash deploy/install.sh
set -euo pipefail

APP_DIR=/opt/kk-mahjong
SERVICE=kk-mahjong
PORT=${PORT:-5173}
SRC_DIR=$(cd "$(dirname "$0")/.." && pwd)

step() { echo; echo "== $* =="; }
fail() { echo "✗ $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || fail "请用 root 运行：sudo bash deploy/install.sh"

step "1/6 检查 Node.js 与基础工具"
if ! command -v curl >/dev/null 2>&1; then
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y curl ca-certificates >/dev/null 2>&1 || true
fi
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
  [ "$NODE_MAJOR" -ge 18 ] && NODE_OK=1
fi
if [ "$NODE_OK" -eq 0 ]; then
  echo "未找到 Node 18+，尝试安装 Node 20 LTS……"
  command -v apt-get >/dev/null 2>&1 || fail "当前系统没有 apt，请手动安装 Node 18+ 后重试"
  apt-get update -qq >/dev/null 2>&1 || true
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || true
  apt-get install -y nodejs >/dev/null 2>&1 || true
fi
command -v node >/dev/null 2>&1 || fail "Node.js 安装失败，请手动安装 Node 18+ 后重试"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 18 ] || fail "Node.js 版本过低：$(node -v)，需要 18 以上"
echo "node $(node -v) ✓"

step "2/6 创建运行用户"
id -u kk >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin kk
echo "用户 kk ✓"

step "3/6 复制运行时文件到 $APP_DIR"
mkdir -p "$APP_DIR"
for item in server.js package.json index.html app.js engine.js styles.css table-depth.css \
            tiles-depth.css seats-layout.css laizi.css rooms.css wall-layout.css landscape.css src assets; do
  [ -e "$SRC_DIR/$item" ] || fail "缺少运行时文件：$item"
  rm -rf "${APP_DIR:?}/$item"
  cp -r "$SRC_DIR/$item" "$APP_DIR/"
done
chown -R root:root "$APP_DIR"
chmod -R a+rX "$APP_DIR"
echo "已部署 $(find "$APP_DIR" -type f | wc -l) 个文件 ✓"

step "4/6 安装并启动 systemd 服务"
cat > "/etc/systemd/system/$SERVICE.service" <<EOF
[Unit]
Description=KK Mahjong room server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=kk
WorkingDirectory=$APP_DIR
Environment=HOST=0.0.0.0
Environment=PORT=$PORT
Environment=NODE_ENV=production
ExecStart=$(command -v node) server.js
Restart=always
RestartSec=2
# 允许非 root 用户绑定 80/443 这类特权端口（PORT=80 时需要）
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=$APP_DIR

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null 2>&1 || true
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || fail "服务启动失败，查看：journalctl -u $SERVICE -n 50 --no-pager"
echo "systemd 服务已常驻并设置开机自启 ✓"

step "5/6 本机自检"
for i in 1 2 3 4 5; do
  if curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; then
    echo "/healthz 返回正常 ✓"
    break
  fi
  [ "$i" = 5 ] && fail "服务未响应，查看：journalctl -u $SERVICE -n 50 --no-pager"
  sleep 1
done
curl -fsS "http://127.0.0.1:$PORT/" | grep -q "KK麻将" && echo "首页内容正常 ✓" || fail "首页内容异常"

step "6/6 放行本机防火墙"
if command -v ufw >/dev/null 2>&1; then
  ufw allow "$PORT/tcp" >/dev/null 2>&1 && echo "ufw 已放行 $PORT/tcp ✓" || echo "ufw 未启用或放行失败，可忽略"
else
  echo "未检测到 ufw，跳过（阿里云请用控制台防火墙）"
fi

PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
if [ "$PORT" = "80" ]; then
  ACCESS_URL="http://${PUBLIC_IP:-<服务器公网IP>}"
else
  ACCESS_URL="http://${PUBLIC_IP:-<服务器公网IP>}:$PORT"
fi
echo
echo "=============================================="
echo " 部署完成"
echo " 访问地址：$ACCESS_URL"
echo
echo " 常用命令："
echo "   systemctl status $SERVICE      # 查看状态"
echo "   journalctl -u $SERVICE -f      # 实时日志"
echo "   systemctl restart $SERVICE     # 重启（房间会清空）"
echo "=============================================="
echo "⚠ 若外网打不开，先在阿里云控制台 → 轻量服务器 → 防火墙，添加规则放行 TCP $PORT"
