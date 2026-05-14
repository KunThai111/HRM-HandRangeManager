/**
 * 动作类型扩展说明：
 *
 * - 「内置动作」固定 4 颗：fold / call / raise / mixed，颜色与名称由产品保留，不可改、不可删。
 * - 「自定义动作」由用户在编辑模式下添加，按 RangeDoc 维度存储；id 形如 `c_xxx`，
 *   名称与颜色任意。Cells 中的值就是动作 id（字符串），渲染时通过 `resolveAction()`
 *   按 id 找到对应的 label/color/textColor。
 * - 因此 `Action` 在类型上是 `string`，调用方按需用 `BUILTIN_ACTIONS` 区分内置 / 自定义。
 */

export const BUILTIN_ACTIONS = ['fold', 'call', 'raise', 'mixed'] as const;
export type BuiltinAction = (typeof BUILTIN_ACTIONS)[number];

/** 动作 id：内置 4 个字面量或任意自定义 id（约定以 `c_` 开头）。 */
export type Action = string;

/**
 * 「格子值」的字符串编码（支持多动作混合）：
 *
 * - 完整（单动作 100%）：直接是 action id，如 `"raise"` / `"c_xxx"`
 * - 单动作部分填充（1-99%）：`"<id>@<weight>"`，例如 `"c_xxx@30"`
 * - 多动作混合：`"<id1>@<w1>+<id2>@<w2>+..."`，例如 `"c_a@50+c_b@40+c_c@10"`
 *   表示 A 占 50%、B 占 40%、C 占 10%；如果各段权重之和小于 100，剩余按 fold 渲染。
 *
 * `fold` 没有权重概念（fold 等价于「清空」，不入库）。
 * 数据形态上 `CellValue` 仍是字符串：旧的单段格式（`c_x` / `c_x@30`）完全兼容。
 */
export type CellValue = string;

export interface CellSegment {
  id: Action;
  weight: number;
}

/** 把权重夹到 [1, 100] 整数区间。 */
export function clampWeight(w: number): number {
  if (!Number.isFinite(w)) return 100;
  const n = Math.round(w);
  if (n < 1) return 1;
  if (n > 100) return 100;
  return n;
}

/**
 * 解析格子值为分段数组。
 * - 空 / fold / 非法 → 返回 `[]`
 * - 老格式 `id` / `id@w` → 单元素数组
 * - 新格式 `id1@w1+id2@w2+...` → 多元素数组（按出现顺序）
 *
 * 不做总和归一：调用方按需自行处理。重复 id 会被合并（权重相加，仍夹在 1-100）。
 */
export function cellSegments(v: CellValue | undefined | null): CellSegment[] {
  if (!v || v === 'fold') return [];
  const parts = v.split('+');
  const merged = new Map<string, number>();
  for (const part of parts) {
    if (!part) continue;
    const at = part.indexOf('@');
    const id = at < 0 ? part : part.slice(0, at);
    if (!id || id === 'fold') continue;
    const wRaw = at < 0 ? 100 : parseInt(part.slice(at + 1), 10);
    const w = Number.isFinite(wRaw) ? wRaw : 100;
    const next = (merged.get(id) ?? 0) + w;
    merged.set(id, next);
  }
  const out: CellSegment[] = [];
  for (const [id, w] of merged.entries()) {
    out.push({ id, weight: clampWeight(w) });
  }
  return out;
}

/** 取格子值的「主」动作 id：多段时返回第一段的 id；fold / 空返回 `'fold'`。 */
export function cellId(v: CellValue): Action {
  const segs = cellSegments(v);
  if (segs.length === 0) return 'fold';
  return segs[0].id;
}

/**
 * 取格子值的总权重（所有动作段之和，1-100）。
 * 单段格式与旧行为完全一致；空 / fold 返回 100（语义：100% fold）。
 */
export function cellWeight(v: CellValue): number {
  const segs = cellSegments(v);
  if (segs.length === 0) return 100;
  let sum = 0;
  for (const s of segs) sum += s.weight;
  return clampWeight(sum);
}

/**
 * 用分段数组构造紧凑的格子值字符串：
 * - 空 / 全 fold → `'fold'`
 * - 单段 100% → 裸 id（与旧版完全等价）
 * - 单段 1-99% → `id@w`
 * - 多段 → `id1@w1+id2@w2+...`，权重按 [1,100] 夹紧，单段为 0 会被丢弃
 * - 重复 id 会被合并；总和会被夹到 ≤100（超出部分丢弃最后一段的多余权重）
 */
export function makeCellValueFromSegments(segments: readonly CellSegment[]): CellValue {
  const merged = new Map<string, number>();
  for (const s of segments) {
    if (!s.id || s.id === 'fold') continue;
    if (!Number.isFinite(s.weight) || s.weight <= 0) continue;
    const w = Math.round(s.weight);
    if (w <= 0) continue;
    merged.set(s.id, (merged.get(s.id) ?? 0) + w);
  }
  // 总和不可 > 100：从尾部裁剪
  let remaining = 100;
  const kept: CellSegment[] = [];
  for (const [id, w] of merged.entries()) {
    if (remaining <= 0) break;
    const take = Math.min(w, remaining);
    if (take <= 0) continue;
    kept.push({ id, weight: take });
    remaining -= take;
  }
  if (kept.length === 0) return 'fold';
  if (kept.length === 1) {
    const only = kept[0];
    return only.weight >= 100 ? only.id : `${only.id}@${only.weight}`;
  }
  return kept.map((s) => `${s.id}@${s.weight}`).join('+');
}

/**
 * 兼容旧 API：单动作 + 权重 → CellValue。
 * 内部走多段编码，结果与旧版一致：`fold` 返回 `'fold'`，100% 返回裸 id，1-99% 返回 `id@w`。
 */
export function makeCellValue(id: Action, weight: number = 100): CellValue {
  if (id === 'fold') return 'fold';
  return makeCellValueFromSegments([{ id, weight: clampWeight(weight) }]);
}

/** 兼容旧调用：`ACTIONS` 仍指向内置 4 个。 */
export const ACTIONS = BUILTIN_ACTIONS;

export const ACTION_LABEL: Record<BuiltinAction, string> = {
  raise: 'Raise',
  call: 'Call',
  fold: 'Fold',
  mixed: 'Mixed',
};

/**
 * 范围表 item 的内置动作配色：
 * - raise: 红色 - 进攻
 * - call:  绿色 - 跟注
 * - fold:  白色 - 弃牌（即范围表 item 的默认背景色）
 * - mixed: 黄色 - 混合频率占位
 */
export const ACTION_COLOR: Record<BuiltinAction, string> = {
  raise: '#dc3545',
  call: '#28a745',
  fold: '#ffffff',
  mixed: '#f4c542',
};

export const ACTION_TEXT_COLOR: Record<BuiltinAction, string> = {
  raise: '#ffffff',
  call: '#ffffff',
  fold: '#1f1f1f',
  mixed: '#1f1f1f',
};

export interface CustomAction {
  /** 形如 `c_xxx`，与内置 id 不冲突。 */
  id: string;
  label: string;
  color: string;
}

export function isBuiltinAction(id: string): id is BuiltinAction {
  return id === 'fold' || id === 'call' || id === 'raise' || id === 'mixed';
}

/** 把任意 hex（`#rgb`/`#rrggbb`，可带 `#`）解析为 RGB；非法返回 null。 */
function parseHex(hex: string): { r: number; g: number; b: number } | null {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * 根据背景色亮度自动返回前景文字色。
 * 亮色背景 → 深灰文字（与 fold/mixed 一致）；暗色背景 → 白色文字。
 */
export function bestTextColorOn(bg: string): string {
  const rgb = parseHex(bg);
  if (!rgb) return '#1f1f1f';
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  return L > 0.55 ? '#1f1f1f' : '#ffffff';
}

export interface ResolvedAction {
  id: string;
  label: string;
  color: string;
  textColor: string;
  builtin: boolean;
}

/** 找不到（custom 已被删但 cells 仍引用）时返回 null。 */
export function resolveAction(
  id: string,
  customs: readonly CustomAction[] = [],
): ResolvedAction | null {
  if (isBuiltinAction(id)) {
    return {
      id,
      label: ACTION_LABEL[id],
      color: ACTION_COLOR[id],
      textColor: ACTION_TEXT_COLOR[id],
      builtin: true,
    };
  }
  const c = customs.find((x) => x.id === id);
  if (!c) return null;
  return {
    id: c.id,
    label: c.label,
    color: c.color,
    textColor: bestTextColorOn(c.color),
    builtin: false,
  };
}

/** 找不到 → 退化成 fold（用于渲染兜底，不修改数据）。 */
export function resolveActionOrFold(
  id: string,
  customs: readonly CustomAction[] = [],
): ResolvedAction {
  return resolveAction(id, customs) ?? resolveAction('fold')!;
}

let customSeq = 0;
export function newCustomActionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `c_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
  }
  customSeq += 1;
  return `c_${Date.now().toString(36)}${customSeq.toString(36)}`;
}

/** 颜色色板（用户点一下就能选，也可手动输入 hex）。 */
export const CUSTOM_COLOR_PRESETS: readonly string[] = [
  '#e85d75',
  '#ff8a3d',
  '#f4c542',
  '#a3d977',
  '#3fb98c',
  '#3fb6c8',
  '#5b8def',
  '#8b6cef',
  '#c46cd6',
  '#9aa3b1',
];
