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
