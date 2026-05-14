# HRM 部署指南（Render 免费套餐）

本指南把 HRM 部署到 [Render](https://render.com) 的 **Free Web Service**，
零信用卡、零月费。前后端共用一个 service（同源 Cookie，省心）。

> ⚠️ Render Free 限制：
> - 15 分钟无访问会进入睡眠（首次访问 ~1 分钟唤醒）
> - 容器文件系统是临时的，每次重启 / 重新部署 **`server/data/hrm.db` 都会被清空**
> - 后果：用户冷启后需要再点一次「使用 Google 登录」，但 Google 那边记得授权过，**只是一次跳转**就回来了，体验影响可控

---

## 步骤 0：把代码 push 到 GitHub

确认 `render.yaml`、`server/`、`.nvmrc`、所有最新改动都在 `main` 分支上。
Render 通过 GitHub 拉代码、自动部署。

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

如果你要给朋友 / 同事用，把他们的 Gmail 也加进来；最多加 100 个。

> 想公开给任何人用？需要把 App 状态从 "Testing" 改为 "In Production"，
> 这要走 Google 的审核流程（如果只用 email/profile scope 是免审的，但仍要填一些信息）。
> 现阶段先用 Testing 模式即可。

最后点 **Save and Continue** → **Back to Dashboard**。

### 1.3 创建 OAuth Client ID

左侧菜单 → **Credentials** → 顶部 **+ CREATE CREDENTIALS** → **OAuth client ID**：

| 字段 | 填写 |
|---|---|
| Application type | **Web application** |
| Name | `HRM Render Production` |
| Authorized JavaScript origins | `https://你的域名.onrender.com` |
| Authorized redirect URIs | `https://你的域名.onrender.com/auth/google/callback` |

> ⚠️ 此时你**还不知道 Render 给的域名**，先随便写一个占位（比如 `https://hrm-placeholder.onrender.com`），
> 走完步骤 2 拿到真实域名后，**回到这个页面把两处 URL 都改成真实的域名**，再点 SAVE。

点 **CREATE**，弹出框里：
- **Client ID** 复制出来存好
- **Client secret** 复制出来存好

---

## 步骤 2：在 Render 创建 Web Service

### 2.1 注册 Render

打开 https://render.com → **Get Started for Free** → 用 GitHub 账号登录授权。

### 2.2 用 Blueprint 一键创建

1. 顶部 **+ New** → **Blueprint**
2. 选择你的 GitHub 仓库（如果没看到，点 **Configure account** 给 Render 仓库读取权限）
3. Render 会自动读取仓库根的 `render.yaml`，识别出叫 `hrm` 的 service
4. **Blueprint Name** 填 `hrm`，点 **Apply**
5. 等几秒，service 创建好后 Render 会跳到一个错误页（因为环境变量还没填，第一次部署会失败）—— **这是正常的，继续往下走**

### 2.3 拿到 Render 给的真实域名

Service 详情页顶部会显示：

```
https://hrm-xxxx.onrender.com
```

**把这个 URL 复制下来**，下一步两个地方都要用。

### 2.4 回 Google Console 更新 Redirect URI

回到步骤 1.3 创建的那个 OAuth Client ID（在 Credentials 页面点它的名字进去）：

- **Authorized JavaScript origins** 改成 `https://hrm-xxxx.onrender.com`
- **Authorized redirect URIs** 改成 `https://hrm-xxxx.onrender.com/auth/google/callback`

点 **SAVE**。

> Google 这边的修改会立即生效。

### 2.5 在 Render 填环境变量

回 Render service 页面 → 左侧 **Environment** → **Add Environment Variable**，逐个加：

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | 步骤 1.3 拿到的 Client ID |
| `GOOGLE_CLIENT_SECRET` | 步骤 1.3 拿到的 Client Secret |
| `GOOGLE_CALLBACK_URL` | `https://hrm-xxxx.onrender.com/auth/google/callback` |
| `FRONTEND_ORIGIN` | `https://hrm-xxxx.onrender.com` |
| `SESSION_SECRET` | 本地跑 `openssl rand -hex 32` 生成的字符串 |

> `NODE_ENV` 和 `NPM_CONFIG_PRODUCTION` 已经在 `render.yaml` 写死，不用手动加。

填完点 **Save Changes**，Render 会自动触发一次重新部署。

### 2.6 等部署完成

左侧 **Logs** 可以看实时日志。期望看到：

```
==> Build successful 🎉
==> Deploying...
[server] listening on http://localhost:10000
[server] mode=production frontend_origin=https://hrm-xxxx.onrender.com
==> Your service is live 🎉
```

> 首次构建大约 3~5 分钟（要 npm install + native 编译 better-sqlite3 + vite build）。

---

## 步骤 3：验证

打开 `https://hrm-xxxx.onrender.com`：

1. 自动跳转到 `/#/login`
2. 点 **使用 Google 账号登录**
3. 选择步骤 1.2 加进 Test users 的那个 Gmail 账号
4. 同意授权
5. 跳回首页，右上角看到你的头像 + 名字 ✅

如果失败，按下表对照：

| 现象 | 排查 |
|---|---|
| 登录后还是停在 `/login` | F12 → Network 看 `/api/me` 返回啥；Render Logs 有没有报错 |
| Google 提示 `Error 400: redirect_uri_mismatch` | 步骤 2.4 没改 / 改错了，必须**一字不差**包括 https / 端口 |
| Google 提示 `Error 403: access_denied` | 你登录的 Gmail 不在 Test users 名单里（步骤 1.2 末尾） |
| 首页能进但右上角没头像 | Render 实例可能在睡眠中刚醒；F5 刷新一下 |
| Render Logs 报 `Missing required environment variable` | 步骤 2.5 漏了某个变量 |

---

## 步骤 4：日常运维

| 操作 | 怎么做 |
|---|---|
| 看实时日志 | Render service → **Logs** |
| 重新部署（不改代码） | Render service → **Manual Deploy** → **Clear build cache & deploy** |
| 部署最新代码 | `git push origin main` 即可，Render 会自动拉取并部署（`autoDeploy: true`） |
| 改环境变量 | Render service → **Environment**（改完会自动重启） |
| 临时停服务 | Render service → **Settings** → **Suspend Web Service** |

---

## 升级路径（以后想要"数据不丢"）

Render Free 数据丢失的根本解法是把 SQLite 换成持久化存储。两个推荐：

1. **升级 Render Starter ($7/月)**：开启 Persistent Disk，挂在 `/opt/render/project/src/server/data`，
   零代码改动。
2. **接外部免费 Postgres**（[Neon](https://neon.tech) 永久免费 0.5GB）：把 `server/src/db.ts`
   换成 `pg` + 改 SQL 方言。改动适中。

需要的时候叫我，可以一并做掉。
