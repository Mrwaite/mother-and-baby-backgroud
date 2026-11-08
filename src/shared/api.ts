// 自动生成，勿改：由 scripts/sync-shared.sh 从 mother-and-baby-mini-program/miniprogram/shared/ 同步
// 前后端共享：接口数据结构（DTO）和错误码。时间均为 UTC 毫秒时间戳，日期为北京时间 `YYYY-MM-DD`

import type { CarePayloadMap, CareType } from './care';
import type { InventoryAction, InventoryCategory } from './inventory';

export const API_PREFIX = '/api/v1';

export const ERROR_CODES = [
  'NO_WX_IDENTITY',
  'NOT_WHITELISTED',
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'TIMER_RUNNING',
  'INSUFFICIENT_STOCK',
  'BABY_REQUIRED',
  'INVALID_FILE',
  'DB_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string };
  /** 403 NOT_WHITELISTED 时返回当前用户的 openid */
  openid?: string;
  /** 409 TIMER_RUNNING 时返回已在进行中的计时 */
  record?: CareRecord;
}

export const MAX_MILESTONE_PHOTOS = 9;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** 对象存储中里程碑照片的目录前缀 */
export const MILESTONE_PHOTO_DIR = 'milestones/';

// ---------- 用户 / 宝宝 ----------

export type Gender = 'male' | 'female';

export interface User {
  id: number;
  displayName: string;
  openid: string;
}

export interface Baby {
  id: number;
  nickname: string;
  gender: Gender;
  birthDate: string;
  birthHeightCm: number | null;
  birthWeightKg: number | null;
  birthHeadCm: number | null;
}

export interface MeResponse {
  user: User;
  baby: Baby | null;
  serverTime: number;
}

export interface BabyInput {
  nickname: string;
  gender: Gender;
  birthDate: string;
  birthHeightCm?: number | null;
  birthWeightKg?: number | null;
  birthHeadCm?: number | null;
}

// ---------- 护理记录 ----------

interface CareRecordBase {
  id: number;
  clientId: string;
  startAt: number;
  /** 计时类：为空表示进行中；时间点类始终为空 */
  endAt: number | null;
  note: string | null;
  createdBy: number;
  createdByName: string;
  updatedBy: number;
  createdAt: number;
  updatedAt: number;
}

export type CareRecordOf<T extends CareType> = CareRecordBase & { type: T; payload: CarePayloadMap[T] };

/** 按 type 区分 payload 结构的联合类型 */
export type CareRecord = { [K in CareType]: CareRecordOf<K> }[CareType];

export type CreateCareRecordInput = {
  [K in CareType]: {
    clientId: string;
    type: K;
    startAt: number;
    endAt?: number | null;
    payload: CarePayloadMap[K];
    note?: string | null;
  };
}[CareType];

/** 部分更新：只传需要修改的字段。type 不可修改 */
export interface UpdateCareRecordInput {
  startAt?: number;
  endAt?: number | null;
  payload?: CarePayloadMap[CareType];
  note?: string | null;
}

export interface DaySummary {
  date: string;
  bottle: { count: number; totalMl: number };
  breastfeed: { count: number; totalMs: number };
  diaper: { count: number; pee: number; poo: number };
  /** 睡眠时长按与当天重叠的部分计算，跨天的睡眠分摊到两天 */
  sleep: { count: number; totalMs: number };
  pump: { count: number; totalMl: number };
  temperature: { count: number; maxCelsius: number | null };
  medicine: { count: number };
  bath: { count: number };
}

export interface MedicineName {
  name: string;
  dose: number;
  unit: CarePayloadMap['medicine']['unit'];
  lastAt: number;
}

export interface LowStockItem {
  id: number;
  name: string;
  spec: string | null;
  quantity: number;
  unit: string;
}

export interface DashboardResponse {
  serverTime: number;
  /** 最近一次喂养（亲喂或瓶喂） */
  lastFeed: CareRecord | null;
  lastDiaper: CareRecord | null;
  /** 进行中的计时（亲喂、睡眠） */
  running: CareRecord[];
  today: DaySummary;
  /** 今天最近 5 条 */
  recent: CareRecord[];
  lowStockCount: number;
  lowStockItems: LowStockItem[];
}

// ---------- 生长测量 / 里程碑 ----------

export interface GrowthRecord {
  id: number;
  measureDate: string;
  heightCm: number | null;
  weightKg: number | null;
  headCm: number | null;
  note: string | null;
  createdBy: number;
  createdAt: number;
  updatedAt: number;
}

export interface GrowthRecordInput {
  measureDate: string;
  heightCm?: number | null;
  weightKg?: number | null;
  headCm?: number | null;
  note?: string | null;
}

export interface Photo {
  /** 服务端 files 表 id */
  id: string;
  /** cloud:// 文件 ID，可直接用于 <image src> */
  fileId: string;
}

export interface Milestone {
  id: number;
  date: string;
  title: string;
  description: string | null;
  photos: Photo[];
  createdBy: number;
  createdAt: number;
  updatedAt: number;
}

export interface MilestoneInput {
  date: string;
  title: string;
  description?: string | null;
  /** 照片 id 列表，顺序即展示顺序 */
  photoIds?: string[];
}

// ---------- 库存 ----------

export interface InventoryItem {
  id: number;
  name: string;
  category: InventoryCategory;
  spec: string | null;
  unit: string;
  quantity: number;
  lowThreshold: number;
  /** quantity ≤ lowThreshold */
  low: boolean;
  archived: boolean;
  note: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface InventoryItemInput {
  name: string;
  category: InventoryCategory;
  spec?: string | null;
  unit: string;
  lowThreshold: number;
  note?: string | null;
  /** 仅新建时有效：初始库存，会记为一条盘点流水 */
  quantity?: number;
}

export interface InventoryItemUpdate {
  name?: string;
  category?: InventoryCategory;
  spec?: string | null;
  unit?: string;
  lowThreshold?: number;
  archived?: boolean;
  note?: string | null;
}

export interface InventoryLog {
  id: number;
  itemId: number;
  action: InventoryAction;
  delta: number;
  quantityBefore: number;
  quantityAfter: number;
  /** 总价（分） */
  priceCents: number | null;
  channel: string | null;
  occurredAt: number;
  note: string | null;
  createdBy: number;
  createdByName: string;
  createdAt: number;
}

export interface InventoryLogInput {
  action: InventoryAction;
  /** in / out：变动数量（> 0）；adjust：盘点后的实际数量（≥ 0） */
  quantity: number;
  priceCents?: number | null;
  channel?: string | null;
  occurredAt?: number;
  note?: string | null;
}

export interface InventoryLogResult {
  item: InventoryItem;
  log: InventoryLog;
}
