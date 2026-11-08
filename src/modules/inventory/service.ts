import { and, asc, desc, eq, lt, lte, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { inventoryItems, inventoryLogs, users } from '../../db/schema';
import { AppError, notFound } from '../../lib/errors';
import type {
  InventoryItem,
  InventoryItemInput,
  InventoryItemUpdate,
  InventoryLog,
  InventoryLogInput,
  InventoryLogResult,
  LowStockItem,
} from '../../shared/api';
import type { AuthUser } from '../../types';

type ItemRow = typeof inventoryItems.$inferSelect;
type LogRow = typeof inventoryLogs.$inferSelect;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

function itemDto(r: ItemRow): InventoryItem {
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    spec: r.spec,
    unit: r.unit,
    quantity: r.quantity,
    lowThreshold: r.lowThreshold,
    low: r.quantity <= r.lowThreshold,
    archived: r.archived === 1,
    note: r.note,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function logDto(r: LogRow, createdByName: string | null): InventoryLog {
  return {
    id: r.id,
    itemId: r.itemId,
    action: r.action,
    delta: r.delta,
    quantityBefore: r.quantityBefore,
    quantityAfter: r.quantityAfter,
    priceCents: r.priceCents,
    channel: r.channel,
    occurredAt: r.occurredAt,
    note: r.note,
    createdBy: r.createdBy,
    createdByName: createdByName ?? '已移除成员',
    createdAt: r.createdAt,
  };
}

export async function listItems(db: Db, archived: boolean): Promise<InventoryItem[]> {
  const rows = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.archived, archived ? 1 : 0))
    .orderBy(asc(inventoryItems.category), asc(inventoryItems.name), asc(inventoryItems.id));
  return rows.map(itemDto);
}

export async function getItem(db: Db | Tx, id: number): Promise<InventoryItem> {
  const [row] = await db.select().from(inventoryItems).where(eq(inventoryItems.id, id)).limit(1);
  if (!row) throw notFound('耗材');
  return itemDto(row);
}

/** 未归档且库存 ≤ 阈值的耗材，按缺口从大到小 */
export async function lowStockItems(db: Db): Promise<LowStockItem[]> {
  return db
    .select({
      id: inventoryItems.id,
      name: inventoryItems.name,
      spec: inventoryItems.spec,
      quantity: inventoryItems.quantity,
      unit: inventoryItems.unit,
    })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.archived, 0), lte(inventoryItems.quantity, inventoryItems.lowThreshold)))
    .orderBy(sql`${inventoryItems.quantity} - ${inventoryItems.lowThreshold}`, asc(inventoryItems.id));
}

export async function createItem(db: Db, user: AuthUser, input: InventoryItemInput): Promise<InventoryItem> {
  const now = Date.now();
  const initial = input.quantity ?? 0;
  const id = await db.transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(inventoryItems)
      .values({
        name: input.name,
        category: input.category,
        spec: input.spec ?? null,
        unit: input.unit,
        quantity: initial,
        lowThreshold: input.lowThreshold,
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    if (initial > 0) {
      await tx.insert(inventoryLogs).values({
        itemId: id,
        action: 'adjust',
        delta: initial,
        quantityBefore: 0,
        quantityAfter: initial,
        occurredAt: now,
        note: '初始库存',
        createdBy: user.id,
        createdAt: now,
      });
    }
    return id;
  });
  return getItem(db, id);
}

export async function updateItem(db: Db, id: number, input: InventoryItemUpdate): Promise<InventoryItem> {
  await getItem(db, id);
  const { archived, ...rest } = input;
  const patch = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  await db
    .update(inventoryItems)
    .set({ ...patch, ...(archived !== undefined && { archived: archived ? 1 : 0 }), updatedAt: Date.now() })
    .where(eq(inventoryItems.id, id));
  return getItem(db, id);
}

/** 流水按 id 倒序分页：before 为上一页最后一条的 id */
export async function listLogs(db: Db, itemId: number, before: number | undefined, limit: number): Promise<InventoryLog[]> {
  await getItem(db, itemId);
  const rows = await db
    .select({ l: inventoryLogs, name: users.displayName })
    .from(inventoryLogs)
    .leftJoin(users, eq(users.id, inventoryLogs.createdBy))
    .where(and(eq(inventoryLogs.itemId, itemId), before === undefined ? undefined : lt(inventoryLogs.id, before)))
    .orderBy(desc(inventoryLogs.id))
    .limit(limit);
  return rows.map((r) => logDto(r.l, r.name));
}

/**
 * 入库 / 出库 / 盘点：同一个事务里用行锁（SELECT … FOR UPDATE）串行化同一耗材的并发操作，
 * 出库后库存不能小于 0。
 */
export async function addLog(db: Db, user: AuthUser, itemId: number, input: InventoryLogInput): Promise<InventoryLogResult> {
  const now = Date.now();
  const logId = await db.transaction(async (tx) => {
    const [item] = await tx
      .select({ quantity: inventoryItems.quantity })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, itemId))
      .for('update');
    if (!item) throw notFound('耗材');

    const before = item.quantity;
    const after = input.action === 'in' ? before + input.quantity : input.action === 'out' ? before - input.quantity : input.quantity;
    if (after < 0) {
      throw new AppError(409, 'INSUFFICIENT_STOCK', `库存不足：当前只有 ${before}`, { quantity: before });
    }

    await tx.update(inventoryItems).set({ quantity: after, updatedAt: now }).where(eq(inventoryItems.id, itemId));
    const [{ id }] = await tx
      .insert(inventoryLogs)
      .values({
        itemId,
        action: input.action,
        delta: after - before,
        quantityBefore: before,
        quantityAfter: after,
        priceCents: input.action === 'in' ? (input.priceCents ?? null) : null,
        channel: input.action === 'in' ? (input.channel ?? null) : null,
        occurredAt: input.occurredAt ?? now,
        note: input.note ?? null,
        createdBy: user.id,
        createdAt: now,
      })
      .$returningId();
    return id;
  });

  const [row] = await db
    .select({ l: inventoryLogs, name: users.displayName })
    .from(inventoryLogs)
    .leftJoin(users, eq(users.id, inventoryLogs.createdBy))
    .where(eq(inventoryLogs.id, logId));
  return { item: await getItem(db, itemId), log: logDto(row!.l, row!.name) };
}
