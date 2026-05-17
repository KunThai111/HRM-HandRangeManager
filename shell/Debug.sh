#!/usr/bin/env bash
# Debug.sh - 本地测试一键启动
#
# 默认模式（推荐）: 跳过登录, /api/* 被前端 mock, 不需要起后端
#   ./shell/Debug.sh
#
# 真实模式: 启动后端 + Google OAuth 登录 (需要 server/.env 配真实凭据)
#   ./shell/Debug.sh --auth

set -euo pipefail

WEB_PORT=7143
API_PORT=3001
URL="http://localhost:${WEB_PORT}/"

# 切到项目根目录（脚本所在目录的上一级）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${PROJECT_ROOT}"

WEB_LOG="${SCRIPT_DIR}/.debug.web.log"
API_LOG="${SCRIPT_DIR}/.debug.api.log"

# 默认跳过登录；--auth 切换为真实模式
NOAUTH=1
for arg in "$@"; do
  case "$arg" in
    --auth) NOAUTH=0 ;;
    --noauth|--no-auth) NOAUTH=1 ;;  # 兼容旧写法
    -h|--help)
      cat <<USAGE
Usage: $0 [--auth]
  (默认)   跳过登录, 走 VITE_DEBUG_NO_AUTH=1, 不需要起后端
  --auth   启用真实 Google 登录, 同时启动后端 server (需要 server/.env)
USAGE
      exit 0 ;;
  esac
done

# 公共函数：释放端口
free_port() {
  local port="$1"
  local name="$2"
  local pids
  pids="$(lsof -ti tcp:${port} || true)"
  if [[ -n "${pids}" ]]; then
    # 多 PID 合并为单行打印
    local pids_oneline
    pids_oneline="$(echo ${pids} | tr '\n' ' ')"
    echo "    [${name}] 端口 ${port} 占用进程: ${pids_oneline}，正在终止..."
    kill -9 ${pids} 2>/dev/null || true
    sleep 1
    local still
    still="$(lsof -ti tcp:${port} || true)"
    if [[ -n "${still}" ]]; then
      echo "    ⚠️  [${name}] 端口 ${port} 仍被占用 (${still})，请手动检查。" >&2
      exit 1
    fi
    echo "    [${name}] 端口 ${port} 已释放 ✅"
  else
    echo "    [${name}] 端口 ${port} 空闲 ✅"
  fi
}

# 公共函数：等待端口就绪
# 退出条件: 端口监听 / 进程退出 / 日志出现错误关键字（防止 tsx watch 假活）
wait_port() {
  local port="$1"
  local name="$2"
  local pid="$3"
  local log="$4"
  local timeout_s=40
  local elapsed=0
  while (( elapsed < timeout_s * 2 )); do
    if lsof -ti tcp:${port} >/dev/null 2>&1; then
      echo "    [${name}] 监听 ${port} 就绪 ✅"
      return 0
    fi
    if ! kill -0 "${pid}" 2>/dev/null; then
      echo "    ⚠️  [${name}] 进程已退出，日志尾部：" >&2
      tail -n 30 "${log}" >&2 || true
      exit 1
    fi
    if grep -Eiq '^(Error:|Missing required|Cannot find|SyntaxError|TypeError|EADDRINUSE)' "${log}" 2>/dev/null; then
      echo "    ⚠️  [${name}] 启动失败（日志中检测到错误），日志尾部：" >&2
      tail -n 30 "${log}" >&2 || true
      kill -9 "${pid}" 2>/dev/null || true
      exit 1
    fi
    sleep 0.5
    elapsed=$((elapsed + 1))
  done
  echo "    ⚠️  [${name}] 等待端口 ${port} 超时，日志尾部：" >&2
  tail -n 30 "${log}" >&2 || true
  exit 1
}

if [[ "${NOAUTH}" == "1" ]]; then
  MODE_DESC="Debug 模式 (跳过登录, 不起后端)"
else
  MODE_DESC="真实模式 (Google 登录 + 后端)"
fi
echo "==> 启动模式: ${MODE_DESC}"

# ---------- 步骤 1: 清理端口 ----------
if [[ "${NOAUTH}" == "1" ]]; then
  echo "==> [1/3] 清理端口 ${WEB_PORT} ..."
  free_port "${WEB_PORT}" "web"
else
  echo "==> [1/4] 清理端口 ${WEB_PORT} 和 ${API_PORT} ..."
  free_port "${WEB_PORT}" "web"
  free_port "${API_PORT}" "api"
fi

# ---------- 步骤 2 (仅真实模式): 启动后端 ----------
API_PID=""
if [[ "${NOAUTH}" == "0" ]]; then
  echo "==> [2/4] 启动后端 server (端口 ${API_PORT}) ..."
  : > "${API_LOG}"
  ( cd "${PROJECT_ROOT}/server" && nohup npm run dev >>"${API_LOG}" 2>&1 & echo $! > "${SCRIPT_DIR}/.debug.api.pid" )
  API_PID="$(cat "${SCRIPT_DIR}/.debug.api.pid")"
  echo "    后端 PID=${API_PID}，日志: ${API_LOG}"
  wait_port "${API_PORT}" "api" "${API_PID}" "${API_LOG}"
fi

# ---------- 步骤 3: 启动前端 ----------
if [[ "${NOAUTH}" == "1" ]]; then
  echo "==> [2/3] 启动前端 vite (端口 ${WEB_PORT}, VITE_DEBUG_NO_AUTH=1) ..."
else
  echo "==> [3/4] 启动前端 vite (端口 ${WEB_PORT}) ..."
fi
: > "${WEB_LOG}"
if [[ "${NOAUTH}" == "1" ]]; then
  nohup npx cross-env VITE_DEBUG_NO_AUTH=1 vite --port "${WEB_PORT}" --strictPort >>"${WEB_LOG}" 2>&1 &
else
  nohup npx vite --port "${WEB_PORT}" --strictPort >>"${WEB_LOG}" 2>&1 &
fi
WEB_PID=$!
echo "${WEB_PID}" > "${SCRIPT_DIR}/.debug.web.pid"
echo "    前端 PID=${WEB_PID}，日志: ${WEB_LOG}"
wait_port "${WEB_PORT}" "web" "${WEB_PID}" "${WEB_LOG}"

# ---------- 步骤 4: 打开浏览器 ----------
if [[ "${NOAUTH}" == "1" ]]; then
  echo "==> [3/3] 打开浏览器: ${URL}"
else
  echo "==> [4/4] 打开浏览器: ${URL}"
fi
if command -v open >/dev/null 2>&1; then
  open "${URL}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${URL}"
else
  echo "    未找到 open / xdg-open，请手动访问: ${URL}"
fi

echo ""
echo "------------------------------------------------------------"
echo "✅ ${MODE_DESC} 已启动"
echo "   URL     : ${URL}"
echo "   Web PID : ${WEB_PID}   日志: ${WEB_LOG}"
if [[ -n "${API_PID}" ]]; then
  echo "   Api PID : ${API_PID}   日志: ${API_LOG}"
fi
echo ""
echo "   停止服务:"
if [[ -n "${API_PID}" ]]; then
  echo "     kill ${WEB_PID} ${API_PID}"
  echo "     # 或:  lsof -ti tcp:${WEB_PORT} tcp:${API_PORT} | xargs kill -9"
else
  echo "     kill ${WEB_PID}"
  echo "     # 或:  lsof -ti tcp:${WEB_PORT} | xargs kill -9"
fi
echo "------------------------------------------------------------"
