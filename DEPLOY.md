# HRM 部署指南（Railway）

把 HRM 部署到 [Railway](https://railway.com) 的 **Hobby 套餐**。
前后端共用一个 service（同源 Cookie，无 CORS），SQLite 数据通过 Volume 持久化。

> 💰 **费用说明**：Railway 没有真正的免费档。
> - **Trial**：注册送 $5 一次性额度，能跑约一个月，不需要绑卡
> - **Hobby**：$5/月（含 $5 用量额度，小项目通常用不完，相当于固定 $5/月）
>
> ✅ **相比 Render Free 的优势**：
> - SQLite 数据通过 Volume 永久保存，**不会因为重启 / 重新部署丢失**
> - **不睡眠、无冷启动**，访问随时秒开
> - 构建速度更快

---

## 步骤 0：把代码 push 到 GitHub

确认 `railway.json`、`server/`、`.nvmrc`、所有最新改动都在 `main` 分支上。
Railway 通过 GitHub 拉代码、自动部署。

---

## 步骤 1：申请 Google OAuth 凭证

> 即使你之前申请过 dev 用的，**生产部署也要重新创建一组**（Authorized URI 不一样）。

### 1.1 进入 Google Cloud Console

浏览器打开 https://console.cloud.google.com/apis/credentials

如果是第一次用，会提示创建项目：项目名随意，例如 `hrm-prod`，地理位置随便选。

### 1.2 配置 OAuth 同意屏幕（OAuth Consent Screen）

左侧菜单 → **APIs & Services** → **OAuth consent screen**：

| 字段 | 填写 |
|---|---|
| User Type | **External**（个人 Gmail 账号） |
| App name | `HRM` |
| User support email | 你的 Gmail |
| Developer contact email | 你的 Gmail |
| App logo / domain | 留空即可 |

点 **Save and Continue**。

#### Scopes 步骤

直接点 **Save and Continue**（默认 scope 已含 email/profile）。

#### Test users 步骤（**重要！**）

点 **+ Add Users**，把你**自己想登录的 Gmail 地址**全部加进去。
**不加就只有应用所有者能登录，其他人都会被拒绝**。

如果要给朋友 / 同事用，把他们的 Gmail 也加进来；最多加 100 个。

> 想公开给任何人用？需要把 App 状态从 "Testing" 改为 "In Production"，
> 这要走 Google 的审核流程（如果只用 email/profile scope 是免审的，但仍要填一些信息）。
> 现阶段先用 Testing 模式即可。

最后点 **Save and Continue** → **Back to Dashboard**。

### 1.3 创建 OAuth Client ID

左侧菜单 → **Credentials** → 顶部 **+ CREATE CREDENTIALS** → **OAuth client ID**：

| 字段 | 填写 |
|---|---|
| Application type | **Web application** |
| Name | `HRM Railway Production` |
| Authorized JavaScript origins | `https://你的域名.up.railway.app` |
| Authorized redirect URIs | `https://你的域名.up.railway.app/auth/google/callback` |

> ⚠️ 此时你**还不知道 Railway 给的域名**，先随便写一个占位（比如 `https://hrm-placeholder.up.railway.app`），
> 走完步骤 2 拿到真实域名后，**回到这个页面把两处 URL 都改成真实的域名**，再点 SAVE。

点 **CREATE**，弹出框里：
- **Client ID** 复制出来存好
- **Client secret** 复制出来存好

---

## 步骤 2：在 Railway 创建项目

### 2.1 注册 Railway

打开 https://railway.com → **Login** → 用 GitHub 账号登录授权。

注册时会送 $5 一次性额度（Trial），可以先用着，跑稳了再升级 Hobby（$5/月）。

### 2.2 从 GitHub 仓库创建 Service

1. 顶部 **+ New Project** → **Deploy from GitHub repo**
2. 第一次需要授权 Railway 访问你的 GitHub（点 **Configure GitHub App** 给仓库读权限）
3. 选中你的 HRM 仓库，Railway 会自动创建 Project + Service
4. Service 默认名为仓库名，可以在 Settings 里改成 `hrm`
5. Railway 会**立即开始构建**，但**第一次会失败**（环境变量还没填）—— 这是正常的，继续往下走

> Railway 自动识别 `railway.json`，按里面定义的 `buildCommand` / `startCommand` 执行。

### 2.3 创建持久化 Volume（**关键步骤**）

这是相对 Render Free 最大的升级 —— SQLite 数据从此不丢。

1. 进入 service → 顶部 **Settings** 标签 → 左侧 **Volumes** 区块（或直接点上方 **Volumes** 子标签）
2. 点 **+ New Volume** / **Add Volume**
3. **Mount Path** 填：`/data`
4. **Size**：默认 1GB 足够（SQLite 这点用户量百年用不完）
5. 点 **Add** / **Create**

> Volume 一旦创建，service 重启 / 重新部署都不会清空 `/data` 目录。

### 2.4 生成公网域名

1. 进入 service → 顶部 **Settings** 标签 → **Networking** / **Public Networking** 区块
2. 点 **Generate Domain**
3. Railway 给你一个形如 `hrm-production-xxxx.up.railway.app` 的域名
4. **复制下来**，下一步两个地方都要用

> 也可以绑自定义域名（**Custom Domain**），后续随时加。

### 2.5 回 Google Console 更新 Redirect URI

回到步骤 1.3 创建的那个 OAuth Client ID（在 Credentials 页面点它的名字进去）：

- **Authorized JavaScript origins** 改成 `https://hrm-production-xxxx.up.railway.app`
- **Authorized redirect URIs** 改成 `https://hrm-production-xxxx.up.railway.app/auth/google/callback`

点 **SAVE**。

> Google 这边的修改会立即生效。

### 2.6 在 Railway 填环境变量

回 Railway service → 顶部 **Variables** 标签 → **+ New Variable**，逐个加：

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NPM_CONFIG_PRODUCTION` | `false` |
| `GOOGLE_CLIENT_ID` | 步骤 1.3 拿到的 Client ID |
| `GOOGLE_CLIENT_SECRET` | 步骤 1.3 拿到的 Client Secret |
| `GOOGLE_CALLBACK_URL` | `https://hrm-production-xxxx.up.railway.app/auth/google/callback` |
| `FRONTEND_ORIGIN` | `https://hrm-production-xxxx.up.railway.app` |
| `SESSION_SECRET` | 本地跑 `openssl rand -hex 32` 生成的字符串 |
| `DB_PATH` | `/data/hrm.db` |

> ⚠️ `DB_PATH=/data/hrm.db` 必须填，否则 SQLite 会写到 service 默认目录，**Volume 就白挂了**。
>
> `PORT` 不用填，Railway 自动注入，`server/src/env.ts` 里已经从 `process.env.PORT` 读取。

填完点 **Save**（或它自动保存），Railway 会自动触发一次重新部署。

> **批量导入小技巧**：Variables 页面右上角点 **Raw Editor**，可以一次性粘贴 KEY=VALUE 形式。

### 2.7 等部署完成

点顶部 **Deployments** 标签看实时构建 / 运行日志。期望看到：

```
Build Logs:
  npm install --include=dev ...
  vite v5.x building for production...
  ✓ built in xxs
  Build successful

Deploy Logs:
  [server] listening on http://localhost:8080
  [server] mode=production frontend_origin=https://hrm-production-xxxx.up.railway.app
```

> 首次构建大约 2~4 分钟（要 npm install + native 编译 better-sqlite3 + vite build）。
> 之后改代码 push，增量构建通常 1~2 分钟。

---

## 步骤 3：验证

打开 `https://hrm-production-xxxx.up.railway.app`：

1. 自动跳转到 `/#/login`
2. 点 **使用 Google 账号登录**
3. 选择步骤 1.2 加进 Test users 的那个 Gmail 账号
4. 同意授权
5. 跳回首页，右上角看到你的头像 + 名字 ✅

**验证数据持久化**：
1. 登录成功后，去 Railway service → **Settings** → 顶部点 **Restart**
2. 等 ~10 秒重启完，刷新页面
3. **不需要重新点登录**，右上角头像还在 ✅（说明 Volume 起作用了）

如果失败，按下表对照：

| 现象 | 排查 |
|---|---|
| 登录后还是停在 `/login` | F12 → Network 看 `/api/me` 返回啥；Railway Deploy Logs 有没有报错 |
| Google 提示 `Error 400: redirect_uri_mismatch` | 步骤 2.5 没改 / 改错了，必须**一字不差**包括 https |
| Google 提示 `Error 403: access_denied` | 你登录的 Gmail 不在 Test users 名单里（步骤 1.2 末尾） |
| 重启后又要重新登录 | `DB_PATH` 没设成 `/data/hrm.db`，或 Volume 没挂在 `/data` |
| Deploy Logs 报 `Missing required environment variable` | 步骤 2.6 漏了某个变量 |
| 构建失败 `better-sqlite3` 编译报错 | 一般是 Node 版本不匹配，确认仓库根 `.nvmrc` 是 `20`，且 Railway 用的 Nixpacks 默认 Node 20+ |

---

## 步骤 4：日常运维

| 操作 | 怎么做 |
|---|---|
| 看实时日志 | service → **Deployments** → 点最新一次部署进去看 Build / Deploy Logs |
| 重新部署（不改代码） | service → **Deployments** → 最新部署右上 **⋮** → **Redeploy** |
| 部署最新代码 | `git push origin main` 即可，Railway 自动拉取并部署 |
| 改环境变量 | service → **Variables**（改完会自动重启） |
| 查看 Volume 用量 | service → **Settings** → **Volumes** |
| 临时停服务 | service → **Settings** → **Danger** → **Remove Service**（或暂停 project） |
| 查看用量费用 | 顶部右上头像 → **Billing** → **Usage** |

---

## 步骤 5：升级到 Hobby（试用额度用完前）

Trial 的 $5 用完后 service 会被暂停。要持续运行：

1. 顶部右上头像 → **Billing** → **Subscribe to Hobby**
2. $5/月，含 $5 用量额度
3. 这个 SPA + SQLite 的占用基本就是 ~$1-2/月，剩余额度白瞎

---

## 备注：本地开发不受影响

本地 `npm run dev:all` 还是跑老一套（Vite :5173 + tsx :3001），
`server/.env` 还是用 localhost OAuth 那套，**完全不冲突**。

---

## 如何回滚到 GitHub Pages 纯前端模式

万一 Railway 哪天不香了，前端纯前端模式（无登录）随时可以走 GitHub Pages：
- 仓库已配 `.github/workflows/deploy.yml`，push `main` 自动部署到 GitHub Pages
- 那条路径走的是 `npm run build`（不带 server），输出 `/HRM-HandRangeManager/` 子路径
- 两条部署路径并存，互不影响
