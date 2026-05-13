# HRM · Hand Range Manager

> 一个轻量、纯前端的德州扑克工具集 —— **起手牌范围编辑器** + **赛事盈亏记录**。
> 全部数据保存在浏览器 `localStorage`，开箱即用，无需后端。

[![Deploy to GitHub Pages](https://github.com/KunThai111/HRM-HandRangeManager/actions/workflows/deploy.yml/badge.svg)](https://github.com/KunThai111/HRM-HandRangeManager/actions/workflows/deploy.yml)

🔗 **在线访问**：<https://kunthai111.github.io/HRM-HandRangeManager/>

---

## ✨ 功能概览

HRM 由两个相互独立、共享同一套 UI 框架的模块组成：

### 1. Range 范围编辑器（`/#/range`）

在标准的 **13×13 起手牌表**上手动标注每一手牌的动作（Fold / Call / Raise / Mixed），并把方案命名保存。每个范围内部按 **筹码深度 × 英雄座位 × 对战座位** 三个维度维护独立的子表。

- **13×13 范围表**：169 格起手牌，默认全 Fold（白底）；左键涂色、按住拖动连续刷、右键单击重置。
- **多深度子表**：每个范围自带一组深度标签（默认 `100bb / 60bb / 40bb / 30bb / 20bb`），可增删改、拖拽排序，并可保存为新建范围时的默认模板。
- **座位维度**：根据创建时选定的桌子人数（2–9 人）自动截断座位序列 `UTG / U1 / U2 / LJ / HJ / CO / BTN / SB / BB`；切换英雄座位即切换对应的子表。
- **对战座位 + 总体（Overall）**：默认整张表为「总体范围」；点击具体对战座位后采用 **Copy-on-Write** 策略，按需分叉出独立范围，未分叉的对战跟随总体。
- **编辑模式（只读 / 可写）**：默认只读防误触，点 `✎ 编辑` 进入；`✓ 确定` 保留涂色但不落盘，`✕ 取消` 一键回滚到进入编辑前的状态。
- **统计**：实时显示当前激活子表的 Raise / Call / Fold 占比。
- **持久化**：所有数据写入 `localStorage`（key：`nlh-range:v2`），刷新后自动恢复上次激活的范围 / 深度 / 英雄座位 / 对战座位。

### 2. Tournaments 赛事记录（`/#/tournaments`）

记录每一场比赛的买入、奖金、名次，并在首页汇总展示：

- **核心指标**：总奖金、总场次、ROI、ITM 率、净盈亏。
- **赛事列表**：按时间线展示历次比赛，支持增删改。
- **首页 Dashboard**（`/`）：以卡片形式聚合上述数据，正负盈亏自动着色。

---

## 🚀 快速开始

### 环境要求

- Node.js ≥ 20
- npm（仓库已包含 `package-lock.json`）

### 本地运行

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:5173）
npm run dev

# 类型检查 + 生产构建（输出到 dist/）
npm run build

# 预览生产构建
npm run preview

# 仅做类型检查
npm run typecheck
```

> 构建时 `vite.config.ts` 会把 `base` 设为 `/HRM-HandRangeManager/`，以匹配 GitHub Pages 的子路径；本地 `npm run dev` 仍走根路径 `/`。

---

## 🛠 技术栈

| 类别 | 选型 |
|---|---|
| 框架 | React 18 + TypeScript 5 |
| 构建 | Vite 5 |
| 路由 | React Router v7（HashRouter，方便 GitHub Pages 直链） |
| 样式 | 原生 CSS Modules（无 Tailwind / 无 UI 库） |
| 状态管理 | 自实现的轻量 store（基于 `useSyncExternalStore`） |
| 持久化 | 浏览器 `localStorage` |
| 部署 | GitHub Actions → GitHub Pages |

---

## 📂 项目结构

```
NLHRange/
├── Doc/                       # 产品文档（中文 PRD）
│   ├── 文档.md                # 主 PRD：功能、数据模型、验收标准
│   └── 文档2.md               # UI 草图补充
├── docs/images/               # 文档配图
├── public/                    # 静态资源（Logo、图标等）
├── src/
│   ├── App.tsx                # 路由入口（HashRouter）
│   ├── main.tsx               # React 挂载点
│   ├── components/
│   │   ├── layout/            # 全局布局（AppLayout）
│   │   ├── home/              # 首页 Dashboard 卡片
│   │   ├── RangeGrid.tsx      # 13×13 范围表
│   │   ├── SeatTabs.tsx       # 英雄 / 对战座位切换
│   │   ├── ActionToolbar.tsx  # 动作色 + 快捷按钮
│   │   ├── Sidebar.tsx        # 左侧栏（范围列表 + 深度列表）
│   │   ├── RangeList.tsx
│   │   ├── DepthList.tsx
│   │   ├── DepthEditorDialog.tsx
│   │   ├── NewRangeDialog.tsx
│   │   ├── CustomActionDialog.tsx
│   │   ├── WeightDialog.tsx
│   │   ├── RangeHeader.tsx
│   │   ├── RangeDetail.tsx
│   │   └── Stats.tsx
│   ├── pages/
│   │   ├── HomePage.tsx       # 首页 Dashboard
│   │   ├── RangePage.tsx      # Range 编辑器
│   │   └── TournamentsPage.tsx# 赛事记录
│   ├── store/
│   │   ├── useRangeStore.ts   # 范围状态 store
│   │   ├── useTournamentStore.ts
│   │   └── storage.ts         # localStorage 读写 + 数据迁移
│   ├── lib/
│   │   ├── hands.ts           # 169 起手牌 key 生成
│   │   ├── depths.ts          # 深度模板与唯一性校验
│   │   ├── seats.ts           # 座位序列按人数截断
│   │   ├── tournaments.ts     # 赛事汇总计算
│   │   └── colors.ts          # 动作 → 颜色映射
│   └── styles/                # CSS Modules
├── .github/workflows/deploy.yml  # GitHub Pages 自动部署
├── vite.config.ts
├── tsconfig.json
└── package.json
```

---

## 🧠 数据模型（Range 核心）

```ts
type Action = 'fold' | 'call' | 'raise' | 'mixed';

type SeatId = 'UTG' | 'U1' | 'U2' | 'LJ' | 'HJ' | 'CO' | 'BTN' | 'SB' | 'BB';

interface SeatBucket {
  overall: Record<string, Action>;            // 总体范围
  vs: Record<string, Record<string, Action>>; // 针对具体对战的独立范围
}

interface DepthGrid {
  label: string;                              // 如 "100bb"
  seats: Record<SeatId, SeatBucket>;
}

interface RangeDoc {
  id: string;
  name: string;
  seats: number;                              // 2–9 桌子人数
  depths: DepthGrid[];
  createdAt: number;
  updatedAt: number;
}
```

完整字段说明、UI 交互细节、编辑模式状态机请参见 [`Doc/文档.md`](Doc/文档.md)。

---

## 🚢 部署

仓库已配置 GitHub Actions 自动部署到 **GitHub Pages**：

1. 任何推送到 `main` 分支的提交都会触发 [`deploy.yml`](.github/workflows/deploy.yml)
2. CI 执行 `npm ci → npm run build → upload-pages-artifact → deploy-pages`
3. 部署完成后访问 <https://kunthai111.github.io/HRM-HandRangeManager/>

> 若 fork 到自己仓库，请同步修改 `vite.config.ts` 中的 `base` 值为你自己的仓库名。

---

## 🗺 Roadmap

非 MVP 阶段的扩展方向（详见 PRD §9）：

- 跨范围 / 跨座位复制（A.BTN.100bb → B.BTN.100bb）
- 范围交集 / 差集对比（高亮重叠区）
- 混合频率扇形显示
- 场景标签（vs3bet / vs4bet / call vs RFI）
- 自定义座位序列、自定义动作颜色
- 导入 / 导出 JSON、PNG
- 与 PIO / GTO+ 兼容的格式
- 简单 Equity 计算（蒙特卡洛 vs 范围）
- 云端同步与账户体系
- 亮色 / 暗色主题切换

---

## 📄 License

本项目为个人工具，暂未声明 License。如需复用源码请先开 Issue 联系作者。

---

## 🙏 致谢

- 灵感来自 PIO Solver、GTO+、Range Trainer 等扑克训练工具
- 169 格 13×13 起手牌表是德州扑克社区的标准呈现形式
