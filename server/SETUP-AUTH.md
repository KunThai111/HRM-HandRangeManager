# 登录功能首次配置指南

HRM 现在带一个独立的 Node 后端（位于 `server/`），用于 Google OAuth 登录与用户会话。这份文档说明**首次跑起来**需要做的全部事情。

---

## 1. 在 Google Cloud Console 申请 OAuth 凭证

1. 打开 https://console.cloud.google.com/
2. 顶部选择/新建一个项目（名字随意，例如 `hrm-dev`）
3. 左侧菜单 → **APIs & Services** → **OAuth consent screen**
   - User type 选 **External**（个人账号即可）→ Create
   - App name 填 `HRM`，User support email 与 Developer contact 填你的 Gmail
   - Scopes 步骤直接 **Save and Continue**（默认已含 email/profile）
   - Test users 加上你自己要登录的 Gmail（**否则只有应用所有者能登录**）
   - 保存即可，不必发布上线
4. 左侧菜单 → **Credentials** → **Create Credentials** → **OAuth client ID**
   - Application type: **Web application**
   - Name: `HRM Local`
   - **Authorized JavaScript origins** 添加：
     - `http://localhost:5173`
   - **Authorized redirect URIs** 添加：
     - `http://localhost:3001/auth/google/callback`
   - 创建后会弹出 **Client ID** 与 **Client Secret**，保存好

---

## 2. 配置后端环境变量

在 `server/` 目录下：

```bash
cp .env.example .env
```

编辑 `server/.env`，填入：

```ini
GOOGLE_CLIENT_ID=粘贴上一步的 Client ID
GOOGLE_CLIENT_SECRET=粘贴上一步的 Client Secret
SESSION_SECRET=$(openssl rand -hex 32 自己跑一下，把输出粘进去)
```

其余字段（`GOOGLE_CALLBACK_URL` / `FRONTEND_ORIGIN` / `PORT` / `DB_PATH`）开发期保持默认即可。

> ⚠️ `.env` 和 `data/` 目录都已经加进 `.gitignore`，不会被提交。

---

## 3. 安装依赖（首次一次即可）

在仓库根目录：

```bash
npm run install:all
```

这会同时安装前端（根目录）和后端（`server/`）的依赖。
（`better-sqlite3` 是原生模块，第一次会编译，约 30~60 秒。）

---

## 4. 启动开发环境

仓库根目录：

```bash
npm run dev:all
```

会同时启动：

- **web** → Vite 前端 `http://localhost:5173`
- **api** → Node 后端 `http://localhost:3001`

只想单独跑某一边时：

```bash
npm run dev          # 只跑前端
npm run dev:server   # 只跑后端
```

---

## 5. 验证登录流程

1. 浏览器打开 http://localhost:5173
2. 未登录会自动跳转到 `/#/login`
3. 点击「使用 Google 账号登录」
4. 完成 Google 授权后回到首页，右上角应出现你的头像 + 名字
5. SQLite 数据库会自动写入 `server/data/hrm.db`，可用任意 SQLite 客户端查看 `users` 表

---

## 常见问题

| 现象 | 原因 / 解决 |
|---|---|
| 登录回来后还是 `/login` | 检查后端是否在跑（`http://localhost:3001/api/health` 应返回 `{ok:true}`） |
| `redirect_uri_mismatch` | Google Console 里的 redirect URI 必须**字符完全一致**，包括协议和端口 |
| `Error: access_denied` | 你的 Gmail 没加进 OAuth consent screen 的 Test users |
| 后端报 `Missing required environment variable` | `server/.env` 没填全；对照 `.env.example` |
| 想用别的端口 | 改 `server/.env` 的 `PORT`，同时改 Google Console 的 redirect URI 与 `vite.config.ts` 的 proxy target |

---

## 生产部署提示（以后再操心）

- 把 `server/.env` 中 `NODE_ENV=production`，`secure: true` 的 cookie 自动开启
- 反向代理（Nginx / Caddy）把 `/auth/*` 与 `/api/*` 转给 Node，其他给静态前端
- `FRONTEND_ORIGIN` 改成线上域名（例如 `https://hrm.example.com`），并去 Google Console 加上对应的 origin 与 callback
- session 存储换成 Redis（`connect-redis`）或 SQLite（`better-sqlite3-session-store`）以支持多实例
