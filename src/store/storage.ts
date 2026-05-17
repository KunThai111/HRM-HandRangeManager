import type { Action, CustomAction } from '@/lib/colors';
import { cellSegments, makeCellValueFromSegments } from '@/lib/colors';
import {
  DEFAULT_DEPTH_LABELS,
  type DepthGrid,
  type SeatOverride,
  emptyDepth,
} from '@/lib/depths';
import { ALL_HAND_KEYS } from '@/lib/hands';
import { isValidSeatId, seatsForCount } from '@/lib/seats';

const VALID_HAND_KEYS = new Set<string>(ALL_HAND_KEYS);

const STORAGE_KEY = 'nlh-range:v3';
const LEGACY_V2_KEY = 'nlh-range:v2';
const LEGACY_V1_KEY = 'nlh-range:v1';

export const MIN_SEATS = 2;
export const MAX_SEATS = 9;
export const DEFAULT_SEATS = 9;

export function clampSeats(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SEATS;
  const n = Math.round(value);
  if (n < MIN_SEATS) return MIN_SEATS;
  if (n > MAX_SEATS) return MAX_SEATS;
  return n;
}

export interface RangeDoc {
  id: string;
  name: string;
  /** 牌桌人数（2-9 人） */
  seats: number;
  depths: DepthGrid[];
  /**
   * 单格备注：key = hand（如 `AKs`/`AA`/`AKo`），value = 用户输入的文字。
   * 按 range 维度存储，所有深度/座位共用同一份。
   * 空字符串与缺失视为「无备注」，序列化时会被剔除。
   */
  notes: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export interface PersistedState {
  version: 3;
  defaultDepthLabels: string[];
  ranges: RangeDoc[];
  lastOpenedRangeId: string | null;
  lastOpenedDepthLabel: string | null;
  lastOpenedSeatId: string | null;
  /**
   * 已删除范围的墓碑：id → 删除时间戳（ms）。
   * 只用于服务端同步时保证「在 A 设备删的范围，B 设备拉下来后也会被清掉」。
   * 不会无限增长：每次同步成功后服务端持有同样的墓碑，本地清不清都行，先一直保留。
   */
  rangeTombstones: Record<string, number>;
  /**
   * 偏好类字段（defaultDepthLabels + 上次打开的范围/深度/座位）整体的版本时间戳。
   * 任何这几项变更都要 bump 此值，服务端按它做整体 LWW。
   * 旧数据没有该字段时回退为 0，第一次有变更后会被覆盖。
   */
  settingsUpdatedAt: number;
}

/**
 * 判断 action id（去掉 `@weight` 后缀的部分）是否合法。
 * - 内置：fold / call / raise / mixed
 * - 自定义：以 `c_` 开头的非空字符串（再细的合法性由编辑流程兜底；
 *   即便 cells 引用了已被删除的 custom id，渲染层会兜底到 fold 颜色）。
 */
function isValidActionId(id: string): boolean {
  if (!id) return false;
  if (id === 'fold' || id === 'call' || id === 'raise' || id === 'mixed') return true;
  return id.startsWith('c_');
}

/**
 * 规范化一个格子值：
 * - 接受裸 id（旧数据，权重 100）、`id@weight`（旧单段部分填充）或新版多段 `id1@w1+id2@w2+...`
 * - 过滤每段的非法 id（不是内置动作也不以 `c_` 开头），剩余空 → null
 * - 各段权重夹到 [1,100]，总和 > 100 时从尾部裁剪
 * - 单段 100% 退化为裸 id；fold（清空）永远不入库 → null
 */
function sanitizeCellValue(v: unknown): Action | null {
  if (typeof v !== 'string' || !v) return null;
  const segs = cellSegments(v).filter((s) => isValidActionId(s.id));
  if (segs.length === 0) return null;
  const out = makeCellValueFromSegments(segs);
  return out === 'fold' ? null : out;
}

function sanitizeCells(raw: unknown): Record<string, Action> {
  const out: Record<string, Action> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_HAND_KEYS.has(k)) continue;
    const sanitized = sanitizeCellValue(v);
    if (sanitized !== null) out[k] = sanitized;
  }
  return out;
}

function sanitizeCustomAction(raw: unknown): CustomAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'string' ? r.id : '';
  const label = typeof r.label === 'string' ? r.label.trim() : '';
  const color = typeof r.color === 'string' ? r.color.trim() : '';
  if (!id.startsWith('c_')) return null;
  if (!label) return null;
  if (!/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(color)) return null;
  return { id, label, color };
}

function sanitizeCustomActions(raw: unknown): CustomAction[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: CustomAction[] = [];
  for (const item of raw) {
    const c = sanitizeCustomAction(item);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/**
 * 单格备注表。只接受合法 hand key 作为索引，且 value 必须是非空字符串。
 * 旧数据没有该字段时会得到 `{}`。
 */
function sanitizeNotes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!VALID_HAND_KEYS.has(k)) continue;
    if (typeof v !== 'string') continue;
    const text = v.replace(/\s+$/u, '');
    if (text) out[k] = text;
  }
  return out;
}

function sanitizeOverride(raw: unknown): SeatOverride | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const cells = sanitizeCells(r.cells);
  const customActions = sanitizeCustomActions(r.customActions);
  if (Object.keys(cells).length === 0 && customActions.length === 0) return null;
  return { cells, customActions };
}

function sanitizeSeatOverrides(raw: unknown): Record<string, SeatOverride> {
  const out: Record<string, SeatOverride> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [seatId, overrideRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidSeatId(seatId)) continue;
    const override = sanitizeOverride(overrideRaw);
    if (override) out[seatId] = override;
  }
  return out;
}

function sanitizeDepthV3(raw: unknown): DepthGrid | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== 'string' || !r.label) return null;
  const sharedCells = sanitizeCells(r.sharedCells);
  const sharedCustomActions = sanitizeCustomActions(r.sharedCustomActions);
  const seatOverrides = sanitizeSeatOverrides(r.seatOverrides);
  const primary =
    typeof r.primarySeatId === 'string' && isValidSeatId(r.primarySeatId)
      ? r.primarySeatId
      : null;
  // primary 不能同时是「已独立」座位
  const primarySeatId =
    primary && Object.prototype.hasOwnProperty.call(seatOverrides, primary)
      ? null
      : primary;
  return {
    label: r.label,
    sharedCells,
    sharedCustomActions,
    seatOverrides,
    primarySeatId,
  };
}

/**
 * 把 v2 的一个 depth（含 seats[seatId].overall / .vs[oppId]）迁移成 v3：
 * - vs[*] 数据直接丢弃（对战概念已整体移除）。
 * - 第一个有 overall 数据的座位 → 升级成 primary，把它的 overall 写入 sharedCells。
 *   该座位的 customActions = rangeCustomActions（保持 v2 时所有座位看到同样按钮的语义）。
 * - 其它有 overall 数据的座位 → 写成 seatOverrides[seatId]，
 *   各自的 customActions 也复制一份 rangeCustomActions（迁移后用户可以单独裁剪它）。
 * - 没有任何 overall 数据的座位 → 不出现，仍是「跟随 shared」。
 */
function migrateDepthFromV2(
  raw: unknown,
  rangeCustomActions: CustomAction[],
  rangeSeats: number,
): DepthGrid | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== 'string' || !r.label) return null;

  // v3 字段优先（如果数据已是 v3 或部分 v3）
  if (r.sharedCells !== undefined || r.seatOverrides !== undefined || r.primarySeatId !== undefined) {
    return sanitizeDepthV3(r);
  }

  const order = seatsForCount(rangeSeats);
  let primary: string | null = null;
  let sharedCells: Record<string, Action> = {};
  const seatOverrides: Record<string, SeatOverride> = {};
  const sharedCustomActions = rangeCustomActions.map((c) => ({ ...c }));

  if (r.seats !== undefined && r.seats && typeof r.seats === 'object') {
    const rawSeats = r.seats as Record<string, unknown>;
    // 按 seatsForCount 顺序遍历，保证 primary 选择稳定
    const seatIds = (order as readonly string[]).filter((id) =>
      Object.prototype.hasOwnProperty.call(rawSeats, id),
    );
    // 也兜底接收顺序外的 seat id
    for (const id of Object.keys(rawSeats)) {
      if (!(seatIds as string[]).includes(id) && isValidSeatId(id)) {
        seatIds.push(id);
      }
    }
    for (const seatId of seatIds) {
      const bucketRaw = rawSeats[seatId];
      if (!bucketRaw || typeof bucketRaw !== 'object') continue;
      const overall = sanitizeCells((bucketRaw as Record<string, unknown>).overall);
      if (Object.keys(overall).length === 0) continue;
      if (!primary) {
        primary = seatId;
        sharedCells = overall;
      } else {
        seatOverrides[seatId] = {
          cells: overall,
          customActions: rangeCustomActions.map((c) => ({ ...c })),
        };
      }
    }
  } else if (r.cells !== undefined) {
    // 极旧 v2：DepthGrid.cells 直接是 cells，按第一个座位归档
    const cells = sanitizeCells(r.cells);
    if (Object.keys(cells).length > 0) {
      const firstSeat = order[0];
      if (firstSeat) {
        primary = firstSeat;
        sharedCells = cells;
      }
    }
  }

  return {
    label: r.label,
    sharedCells,
    sharedCustomActions,
    seatOverrides,
    primarySeatId: primary,
  };
}

/**
 * 把任意原始数据规范化为 v3 RangeDoc：
 * - 接受 v3 形态（sharedCells / seatOverrides / primarySeatId）
 * - 接受 v2 形态（顶层 customActions + depths[i].seats[seatId].overall/.vs）
 * - 没有任何合法 depth → 返回 null
 *
 * 也会自动迁移 v2 的 range.customActions（range 级共享）→ 每个 depth 的 sharedCustomActions。
 */
export function sanitizeRangeDoc(raw: unknown): RangeDoc | null {
  return sanitizeRange(raw);
}

function sanitizeRange(raw: unknown): RangeDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (typeof r.name !== 'string') return null;
  if (typeof r.createdAt !== 'number' || typeof r.updatedAt !== 'number') return null;
  if (!Array.isArray(r.depths)) return null;

  const seats = clampSeats(r.seats);
  // v2 兼容：旧数据有顶层 customActions（range 级共享）；v3 已废弃，这里读出来用作 depth 的 sharedCustomActions 默认值
  const legacyCustomActions = sanitizeCustomActions(r.customActions);

  const depths = r.depths
    .map((d) => migrateDepthFromV2(d, legacyCustomActions, seats))
    .filter((d): d is DepthGrid => d !== null);

  // 去重 label（保留第一次出现）
  const seen = new Set<string>();
  const deduped: DepthGrid[] = [];
  for (const d of depths) {
    if (seen.has(d.label)) continue;
    seen.add(d.label);
    deduped.push(d);
  }

  if (deduped.length === 0) return null;

  return {
    id: r.id,
    name: r.name,
    seats,
    depths: deduped,
    notes: sanitizeNotes(r.notes),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * v1 旧结构：`{ version: 1, ranges: [{ id, stack, name, cells, createdAt, updatedAt }], lastOpenedStack, lastOpenedId }`
 * v3 新结构按 name 合并：同名 range 合并为一个 RangeDoc，按 stack 字段填入 depths，
 * cells 暂归入 9 人桌 UTG 座位的 sharedCells（旧结构无座位 / 对战概念）。
 */
function migrateV1(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version !== 1 || !Array.isArray(r.ranges)) return null;

  const byName = new Map<string, RangeDoc>();
  for (const item of r.ranges) {
    if (!item || typeof item !== 'object') continue;
    const it = item as Record<string, unknown>;
    const id = typeof it.id === 'string' ? it.id : '';
    const stack = typeof it.stack === 'string' ? it.stack : '';
    const name = typeof it.name === 'string' ? it.name : '';
    const createdAt = typeof it.createdAt === 'number' ? it.createdAt : Date.now();
    const updatedAt = typeof it.updatedAt === 'number' ? it.updatedAt : createdAt;
    if (!id || !name || !stack) continue;

    const cells = sanitizeCells(it.cells);
    const seatOrder = seatsForCount(DEFAULT_SEATS);
    const firstSeat = seatOrder[0];
    const depth: DepthGrid = {
      label: stack,
      sharedCells: Object.keys(cells).length > 0 ? cells : {},
      sharedCustomActions: [],
      seatOverrides: {},
      primarySeatId: Object.keys(cells).length > 0 ? firstSeat : null,
    };

    const existing = byName.get(name);
    if (existing) {
      if (existing.depths.some((d) => d.label === stack)) continue;
      existing.depths.push(depth);
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
      existing.createdAt = Math.min(existing.createdAt, createdAt);
    } else {
      byName.set(name, {
        id,
        name,
        seats: DEFAULT_SEATS,
        depths: [depth],
        notes: {},
        createdAt,
        updatedAt,
      });
    }
  }

  return {
    version: 3,
    defaultDepthLabels: [...DEFAULT_DEPTH_LABELS],
    ranges: [...byName.values()],
    lastOpenedRangeId: null,
    lastOpenedDepthLabel:
      typeof r.lastOpenedStack === 'string' ? (r.lastOpenedStack as string) : null,
    lastOpenedSeatId: null,
    rangeTombstones: {},
    settingsUpdatedAt: 0,
  };
}

function sanitizeTombstones(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k) continue;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    out[k] = v;
  }
  return out;
}

/**
 * 从一段 raw v2/v3 PersistedState（来自 localStorage 或服务端 pull）规范化为 v3。
 * - 顶层版本不区分：里面的 ranges 会逐个用 sanitizeRange 清洗，
 *   旧 v2 的 SeatBucket / range.customActions / lastOpenedOpponentId 字段会被自动迁移或丢弃。
 */
export function sanitizePersisted(raw: unknown): PersistedState | null {
  if (!raw || typeof raw !== 'object') return null;
  const parsed = raw as Partial<PersistedState> & Record<string, unknown>;
  if (!Array.isArray(parsed.ranges)) return null;
  const ranges = parsed.ranges
    .map(sanitizeRange)
    .filter((x): x is RangeDoc => x !== null);
  const defaultDepthLabels =
    Array.isArray(parsed.defaultDepthLabels) &&
    parsed.defaultDepthLabels.every((x) => typeof x === 'string')
      ? (parsed.defaultDepthLabels as string[])
      : [...DEFAULT_DEPTH_LABELS];
  return {
    version: 3,
    defaultDepthLabels,
    ranges,
    lastOpenedRangeId:
      typeof parsed.lastOpenedRangeId === 'string' ? parsed.lastOpenedRangeId : null,
    lastOpenedDepthLabel:
      typeof parsed.lastOpenedDepthLabel === 'string'
        ? parsed.lastOpenedDepthLabel
        : null,
    lastOpenedSeatId:
      typeof parsed.lastOpenedSeatId === 'string' && isValidSeatId(parsed.lastOpenedSeatId)
        ? parsed.lastOpenedSeatId
        : null,
    rangeTombstones: sanitizeTombstones(parsed.rangeTombstones),
    settingsUpdatedAt:
      typeof parsed.settingsUpdatedAt === 'number' &&
      Number.isFinite(parsed.settingsUpdatedAt)
        ? parsed.settingsUpdatedAt
        : 0,
  };
}

export function loadState(): PersistedState {
  if (typeof localStorage === 'undefined') return cloneEmpty();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = sanitizePersisted(JSON.parse(raw));
      if (parsed) return parsed;
    }

    const legacyV2 = localStorage.getItem(LEGACY_V2_KEY);
    if (legacyV2) {
      const parsed = sanitizePersisted(JSON.parse(legacyV2));
      if (parsed) {
        saveState(parsed);
        return parsed;
      }
    }

    const legacyV1 = localStorage.getItem(LEGACY_V1_KEY);
    if (legacyV1) {
      const migrated = migrateV1(JSON.parse(legacyV1));
      if (migrated) {
        saveState(migrated);
        return migrated;
      }
    }

    return cloneEmpty();
  } catch (err) {
    console.warn('[nlh-range] load failed, fallback to empty', err);
    return cloneEmpty();
  }
}

function cloneEmpty(): PersistedState {
  return {
    version: 3,
    defaultDepthLabels: [...DEFAULT_DEPTH_LABELS],
    ranges: [],
    lastOpenedRangeId: null,
    lastOpenedDepthLabel: null,
    lastOpenedSeatId: null,
    rangeTombstones: {},
    settingsUpdatedAt: 0,
  };
}

export function saveState(state: PersistedState): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('[nlh-range] save failed', err);
  }
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function makeRange(
  name: string,
  depthLabels: readonly string[],
  seats: number = DEFAULT_SEATS,
  now: number = Date.now(),
): RangeDoc {
  return {
    id: newId(),
    name: name.trim() || 'Untitled',
    seats: clampSeats(seats),
    depths: depthLabels.map((l) => emptyDepth(l)),
    notes: {},
    createdAt: now,
    updatedAt: now,
  };
}
