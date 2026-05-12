import type { Action, CustomAction } from '@/lib/colors';
import {
  DEFAULT_DEPTH_LABELS,
  type DepthGrid,
  type SeatBucket,
  emptyDepth,
} from '@/lib/depths';
import { isValidSeatId, seatsForCount } from '@/lib/seats';

const STORAGE_KEY = 'nlh-range:v2';
const LEGACY_KEY = 'nlh-range:v1';

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
  /** 用户在编辑模式下添加的自定义动作按钮（按 range 维度独立）。 */
  customActions: CustomAction[];
  createdAt: number;
  updatedAt: number;
}

export interface PersistedState {
  version: 2;
  defaultDepthLabels: string[];
  ranges: RangeDoc[];
  lastOpenedRangeId: string | null;
  lastOpenedDepthLabel: string | null;
  lastOpenedSeatId: string | null;
  /** null = 总体（默认），string = 具体对战座位 id */
  lastOpenedOpponentId: string | null;
}

/**
 * 判断字符串是否是合法的 action id。
 * - 内置：fold / call / raise / mixed
 * - 自定义：以 `c_` 开头的非空字符串（再细的合法性由编辑流程兜底；
 *   即便 cells 引用了已被删除的 custom id，渲染层会兜底到 fold 颜色）。
 */
function isActionId(value: unknown): value is Action {
  if (typeof value !== 'string' || !value) return false;
  if (value === 'fold' || value === 'call' || value === 'raise' || value === 'mixed') return true;
  return value.startsWith('c_');
}

function sanitizeCells(raw: unknown): Record<string, Action> {
  const out: Record<string, Action> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isActionId(v) && v !== 'fold') out[k] = v;
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

/** 把任意原始数据规范化成 SeatBucket；若整体为空返回 null（外层会跳过）。 */
function sanitizeSeatBucket(raw: unknown): SeatBucket | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // 新结构：{ overall, vs: { oppId: cells } }
  if (r.overall !== undefined || r.vs !== undefined) {
    const overall = sanitizeCells(r.overall);
    const vs: Record<string, Record<string, Action>> = {};
    if (r.vs && typeof r.vs === 'object') {
      for (const [oppId, cells] of Object.entries(r.vs as Record<string, unknown>)) {
        if (!isValidSeatId(oppId)) continue;
        const sanitized = sanitizeCells(cells);
        if (Object.keys(sanitized).length > 0) vs[oppId] = sanitized;
      }
    }
    if (Object.keys(overall).length === 0 && Object.keys(vs).length === 0) return null;
    return { overall, vs };
  }

  // 旧结构（v2 早期）：seats[seatId] 直接是 Record<HandKey, Action>
  const overall = sanitizeCells(raw);
  if (Object.keys(overall).length === 0) return null;
  return { overall, vs: {} };
}

function sanitizeSeatsMap(raw: unknown): Record<string, SeatBucket> {
  const out: Record<string, SeatBucket> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [seatId, bucketRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!isValidSeatId(seatId)) continue;
    const bucket = sanitizeSeatBucket(bucketRaw);
    if (bucket) out[seatId] = bucket;
  }
  return out;
}

/**
 * 把单一 cells 升级为「按第一个座位归档」的 seats 映射（仅总体，无对战独立数据）。
 * 用于 v1 / 极旧 v2 (`DepthGrid.cells`) 数据的兼容。
 */
function liftCellsToSeats(
  cells: Record<string, Action>,
  rangeSeats: number,
): Record<string, SeatBucket> {
  if (Object.keys(cells).length === 0) return {};
  const order = seatsForCount(rangeSeats);
  const firstSeat = order[0];
  if (!firstSeat) return {};
  return { [firstSeat]: { overall: cells, vs: {} } };
}

function sanitizeDepth(raw: unknown, rangeSeats: number): DepthGrid | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== 'string' || !r.label) return null;

  if (r.seats !== undefined) {
    return { label: r.label, seats: sanitizeSeatsMap(r.seats) };
  }
  if (r.cells !== undefined) {
    return {
      label: r.label,
      seats: liftCellsToSeats(sanitizeCells(r.cells), rangeSeats),
    };
  }
  return { label: r.label, seats: {} };
}

function sanitizeRange(raw: unknown): RangeDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (typeof r.name !== 'string') return null;
  if (typeof r.createdAt !== 'number' || typeof r.updatedAt !== 'number') return null;
  if (!Array.isArray(r.depths)) return null;

  const seats = clampSeats(r.seats);

  const depths = r.depths
    .map((d) => sanitizeDepth(d, seats))
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
    customActions: sanitizeCustomActions(r.customActions),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * v1 旧结构：`{ version: 1, ranges: [{ id, stack, name, cells, createdAt, updatedAt }], lastOpenedStack, lastOpenedId }`
 * v2 新结构按 name 合并：同名 range 合并为一个 RangeDoc，按 stack 字段填入 depths，
 * cells 暂归入 9 人桌 UTG 座位的「总体」（旧结构无座位 / 对战概念）。
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
    const seatsMap = liftCellsToSeats(cells, DEFAULT_SEATS);
    const existing = byName.get(name);
    if (existing) {
      if (existing.depths.some((d) => d.label === stack)) continue;
      existing.depths.push({ label: stack, seats: seatsMap });
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
      existing.createdAt = Math.min(existing.createdAt, createdAt);
    } else {
      byName.set(name, {
        id,
        name,
        seats: DEFAULT_SEATS,
        depths: [{ label: stack, seats: seatsMap }],
        customActions: [],
        createdAt,
        updatedAt,
      });
    }
  }

  return {
    version: 2,
    defaultDepthLabels: [...DEFAULT_DEPTH_LABELS],
    ranges: [...byName.values()],
    lastOpenedRangeId: null,
    lastOpenedDepthLabel:
      typeof r.lastOpenedStack === 'string' ? (r.lastOpenedStack as string) : null,
    lastOpenedSeatId: null,
    lastOpenedOpponentId: null,
  };
}

export function loadState(): PersistedState {
  if (typeof localStorage === 'undefined') return cloneEmpty();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
      if (parsed && parsed.version === 2 && Array.isArray(parsed.ranges)) {
        const ranges = parsed.ranges
          .map(sanitizeRange)
          .filter((x): x is RangeDoc => x !== null);
        const defaultDepthLabels =
          Array.isArray(parsed.defaultDepthLabels) &&
          parsed.defaultDepthLabels.every((x) => typeof x === 'string')
            ? (parsed.defaultDepthLabels as string[])
            : [...DEFAULT_DEPTH_LABELS];
        return {
          version: 2,
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
          lastOpenedOpponentId:
            typeof parsed.lastOpenedOpponentId === 'string' &&
            isValidSeatId(parsed.lastOpenedOpponentId)
              ? parsed.lastOpenedOpponentId
              : null,
        };
      }
    }

    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const migrated = migrateV1(JSON.parse(legacy));
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
    version: 2,
    defaultDepthLabels: [...DEFAULT_DEPTH_LABELS],
    ranges: [],
    lastOpenedRangeId: null,
    lastOpenedDepthLabel: null,
    lastOpenedSeatId: null,
    lastOpenedOpponentId: null,
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
    customActions: [],
    createdAt: now,
    updatedAt: now,
  };
}
