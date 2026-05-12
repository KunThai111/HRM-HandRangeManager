import type { Action } from '@/lib/colors';
import {
  DEFAULT_DEPTH_LABELS,
  type DepthGrid,
  emptyDepth,
} from '@/lib/depths';

const STORAGE_KEY = 'nlh-range:v2';
const LEGACY_KEY = 'nlh-range:v1';

export interface RangeDoc {
  id: string;
  name: string;
  depths: DepthGrid[];
  createdAt: number;
  updatedAt: number;
}

export interface PersistedState {
  version: 2;
  defaultDepthLabels: string[];
  ranges: RangeDoc[];
  lastOpenedRangeId: string | null;
  lastOpenedDepthLabel: string | null;
}

function isAction(value: unknown): value is Action {
  return value === 'fold' || value === 'call' || value === 'raise' || value === 'mixed';
}

function sanitizeCells(raw: unknown): Record<string, Action> {
  const out: Record<string, Action> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isAction(v) && v !== 'fold') out[k] = v;
  }
  return out;
}

function sanitizeDepth(raw: unknown): DepthGrid | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.label !== 'string' || !r.label) return null;
  return { label: r.label, cells: sanitizeCells(r.cells) };
}

function sanitizeRange(raw: unknown): RangeDoc | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string') return null;
  if (typeof r.name !== 'string') return null;
  if (typeof r.createdAt !== 'number' || typeof r.updatedAt !== 'number') return null;
  if (!Array.isArray(r.depths)) return null;

  const depths = r.depths
    .map(sanitizeDepth)
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
    depths: deduped,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/**
 * v1 旧结构：`{ version: 1, ranges: [{ id, stack, name, cells, createdAt, updatedAt }], lastOpenedStack, lastOpenedId }`
 * v2 新结构按 name 合并：同名 range 合并为一个 RangeDoc，按 stack 字段填入 depths。
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
    const existing = byName.get(name);
    if (existing) {
      // 已存在同名 range：把当前 stack 作为深度追加（如重名则跳过）
      if (existing.depths.some((d) => d.label === stack)) continue;
      existing.depths.push({ label: stack, cells });
      existing.updatedAt = Math.max(existing.updatedAt, updatedAt);
      existing.createdAt = Math.min(existing.createdAt, createdAt);
    } else {
      byName.set(name, {
        id,
        name,
        depths: [{ label: stack, cells }],
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
        };
      }
    }

    // 尝试 v1 迁移
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
  now: number = Date.now(),
): RangeDoc {
  return {
    id: newId(),
    name: name.trim() || 'Untitled',
    depths: depthLabels.map((l) => emptyDepth(l)),
    createdAt: now,
    updatedAt: now,
  };
}
