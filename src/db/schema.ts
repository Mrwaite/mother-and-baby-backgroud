import { sql } from 'drizzle-orm';
import {
  bigint,
  char,
  decimal,
  index,
  int,
  json,
  mysqlTable,
  primaryKey,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import type { CarePayload, CareType } from '../shared/care';
import type { InventoryAction, InventoryCategory } from '../shared/inventory';

// 时间字段统一为 UTC 毫秒时间戳；日期字段为北京时间 YYYY-MM-DD
const id = () => bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();
const ref = (name: string) => bigint(name, { mode: 'number', unsigned: true });
const ts = (name: string) => bigint(name, { mode: 'number' });
const createdAt = () => ts('created_at').notNull();
const updatedAt = () => ts('updated_at').notNull();
const deletedAt = () => ts('deleted_at');

export const users = mysqlTable('users', {
  id: id(),
  openid: varchar('openid', { length: 64 }).notNull().unique('uk_openid'),
  displayName: varchar('display_name', { length: 32 }).notNull(),
  enabled: tinyint('enabled').notNull().default(1),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const baby = mysqlTable('baby', {
  id: id(),
  nickname: varchar('nickname', { length: 32 }).notNull(),
  gender: varchar('gender', { length: 8 }).$type<'male' | 'female'>().notNull(),
  birthDate: char('birth_date', { length: 10 }).notNull(),
  birthHeightCm: decimal('birth_height_cm', { precision: 5, scale: 1, mode: 'number' }),
  birthWeightKg: decimal('birth_weight_kg', { precision: 5, scale: 2, mode: 'number' }),
  birthHeadCm: decimal('birth_head_cm', { precision: 5, scale: 1, mode: 'number' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const careRecords = mysqlTable(
  'care_records',
  {
    id: id(),
    clientId: char('client_id', { length: 36 }).notNull(),
    type: varchar('type', { length: 16 }).$type<CareType>().notNull(),
    startAt: ts('start_at').notNull(),
    endAt: ts('end_at'),
    payload: json('payload').$type<CarePayload>().notNull(),
    note: varchar('note', { length: 500 }),
    createdBy: ref('created_by').notNull(),
    updatedBy: ref('updated_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
    // MySQL 没有部分索引：用生成列 + 唯一索引保证同类计时最多 1 个进行中（唯一索引允许多个 NULL）
    runningType: varchar('running_type', { length: 16 }).generatedAlwaysAs(
      sql`(case when end_at is null and deleted_at is null and type in ('breastfeed', 'sleep') then type end)`,
      { mode: 'virtual' },
    ),
  },
  (t) => [
    uniqueIndex('uk_client_id').on(t.clientId),
    uniqueIndex('uk_running_type').on(t.runningType),
    index('idx_deleted_start').on(t.deletedAt, t.startAt),
    index('idx_type_start').on(t.type, t.startAt),
  ],
);

export const growthRecords = mysqlTable(
  'growth_records',
  {
    id: id(),
    measureDate: char('measure_date', { length: 10 }).notNull(),
    heightCm: decimal('height_cm', { precision: 5, scale: 1, mode: 'number' }),
    weightKg: decimal('weight_kg', { precision: 5, scale: 2, mode: 'number' }),
    headCm: decimal('head_cm', { precision: 5, scale: 1, mode: 'number' }),
    note: varchar('note', { length: 500 }),
    createdBy: ref('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('idx_measure_date').on(t.measureDate)],
);

export const milestones = mysqlTable(
  'milestones',
  {
    id: id(),
    date: char('date', { length: 10 }).notNull(),
    title: varchar('title', { length: 64 }).notNull(),
    description: varchar('description', { length: 1000 }),
    createdBy: ref('created_by').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index('idx_date').on(t.date)],
);

export const files = mysqlTable('files', {
  id: char('id', { length: 36 }).primaryKey(),
  cloudFileId: varchar('cloud_file_id', { length: 512 }).notNull().unique('uk_cloud_file_id'),
  size: int('size').notNull(),
  mime: varchar('mime', { length: 64 }).notNull(),
  createdBy: ref('created_by').notNull(),
  createdAt: createdAt(),
  deletedAt: deletedAt(),
});

export const milestonePhotos = mysqlTable(
  'milestone_photos',
  {
    milestoneId: ref('milestone_id').notNull(),
    fileId: char('file_id', { length: 36 }).notNull(),
    sort: int('sort').notNull(),
  },
  (t) => [primaryKey({ columns: [t.milestoneId, t.fileId] })],
);

export const inventoryItems = mysqlTable('inventory_items', {
  id: id(),
  name: varchar('name', { length: 64 }).notNull(),
  category: varchar('category', { length: 16 }).$type<InventoryCategory>().notNull(),
  spec: varchar('spec', { length: 32 }),
  unit: varchar('unit', { length: 8 }).notNull(),
  quantity: int('quantity').notNull().default(0),
  lowThreshold: int('low_threshold').notNull().default(0),
  archived: tinyint('archived').notNull().default(0),
  note: varchar('note', { length: 500 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const inventoryLogs = mysqlTable(
  'inventory_logs',
  {
    id: id(),
    itemId: ref('item_id').notNull(),
    action: varchar('action', { length: 8 }).$type<InventoryAction>().notNull(),
    delta: int('delta').notNull(),
    quantityBefore: int('quantity_before').notNull(),
    quantityAfter: int('quantity_after').notNull(),
    priceCents: int('price_cents'),
    channel: varchar('channel', { length: 32 }),
    occurredAt: ts('occurred_at').notNull(),
    note: varchar('note', { length: 500 }),
    createdBy: ref('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('idx_item_id').on(t.itemId, t.id)],
);

export const backupRuns = mysqlTable('backup_runs', {
  id: id(),
  date: char('date', { length: 10 }).notNull().unique('uk_date'),
  cosKey: varchar('cos_key', { length: 255 }).notNull(),
  size: int('size').notNull(),
  createdAt: createdAt(),
});

/** 备份 / 恢复涉及的业务表（按恢复时的插入顺序排列） */
export const BUSINESS_TABLES = {
  users,
  baby,
  care_records: careRecords,
  growth_records: growthRecords,
  milestones,
  files,
  milestone_photos: milestonePhotos,
  inventory_items: inventoryItems,
  inventory_logs: inventoryLogs,
} as const;
