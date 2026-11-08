// 自动生成，勿改：由 scripts/sync-shared.sh 从 mother-and-baby-mini-program/miniprogram/shared/ 同步
// 前后端共享：耗材库存相关常量

export const INVENTORY_CATEGORIES = ['diaper', 'formula', 'wipes', 'toiletries', 'other'] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_CATEGORY_LABELS: Record<InventoryCategory, string> = {
  diaper: '纸尿裤',
  formula: '奶粉',
  wipes: '湿巾',
  toiletries: '洗护',
  other: '其他',
};

/** in：入库；out：出库；adjust：盘点（直接修正为实际数量） */
export const INVENTORY_ACTIONS = ['in', 'out', 'adjust'] as const;
export type InventoryAction = (typeof INVENTORY_ACTIONS)[number];

export const INVENTORY_ACTION_LABELS: Record<InventoryAction, string> = {
  in: '入库',
  out: '出库',
  adjust: '盘点',
};

/** 常用计量单位（耗材档案中也可以自定义） */
export const INVENTORY_UNITS = ['片', '包', '罐', '盒', '瓶', '袋', '支', '个'] as const;
