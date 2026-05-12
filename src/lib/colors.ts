export const ACTIONS = ['fold', 'call', 'raise', 'mixed'] as const;

export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<Action, string> = {
  raise: 'Raise',
  call: 'Call',
  fold: 'Fold',
  mixed: 'Mixed',
};

/**
 * 暗色主题下保持高对比度的动作配色。
 * - raise: 红色 - 进攻
 * - call:  绿色 - 跟注
 * - fold:  灰色 - 弃牌（默认）
 * - mixed: 黄色 - 混合频率占位
 */
export const ACTION_COLOR: Record<Action, string> = {
  raise: '#dc3545',
  call: '#28a745',
  fold: '#3a3f4b',
  mixed: '#f4c542',
};

export const ACTION_TEXT_COLOR: Record<Action, string> = {
  raise: '#ffffff',
  call: '#ffffff',
  fold: '#c8ccd4',
  mixed: '#1f1f1f',
};
