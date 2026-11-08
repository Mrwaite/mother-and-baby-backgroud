import { and, desc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { isDuplicateKey } from '../../db/client';
import { careRecords, users } from '../../db/schema';
import { AppError, badRequest, notFound } from '../../lib/errors';
import type { CareRecord, DaySummary, MedicineName } from '../../shared/api';
import { isTimerType, type CarePayloadMap, type CareType } from '../../shared/care';
import { DAY_MS, MINUTE_MS, dayStartFromKey } from '../../shared/time';
import type { AuthUser } from '../../types';
import { payloadSchemas, type createBody, type updateBody } from './schema';
import type { z } from 'zod';

type Row = typeof careRecords.$inferSelect;

const MAX_DURATION_MS = DAY_MS;
const FUTURE_TOLERANCE_MS = 5 * MINUTE_MS;

const selection = { r: careRecords, name: users.displayName };

function toDto(row: Row, createdByName: string | null): CareRecord {
  return {
    id: row.id,
    clientId: row.clientId,
    type: row.type,
    startAt: row.startAt,
    endAt: row.endAt,
    payload: row.payload,
    note: row.note,
    createdBy: row.createdBy,
    createdByName: createdByName ?? '已移除成员',
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as CareRecord;
}

function baseQuery(db: Db) {
  return db.select(selection).from(careRecords).leftJoin(users, eq(users.id, careRecords.createdBy));
}

const mapRows = (rows: { r: Row; name: string | null }[]) => rows.map((x) => toDto(x.r, x.name));

export function parsePayload<T extends CareType>(type: T, payload: unknown): CarePayloadMap[T] {
  const result = payloadSchemas[type].safeParse(payload ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(`payload.${issue?.path.join('.') ?? ''}：${issue?.message ?? '格式错误'}`);
  }
  return result.data as CarePayloadMap[T];
}

/** 校验并规范化时间字段：时间点类没有 endAt；计时类结束时关闭进行中的亲喂分段 */
function normalize(type: CareType, startAt: number, endAt: number | null, payload: CarePayloadMap[CareType], now: number) {
  if (startAt > now + FUTURE_TOLERANCE_MS) throw badRequest('开始时间不能晚于现在');
  if (!isTimerType(type)) return { endAt: null, payload };

  if (endAt !== null) {
    if (endAt < startAt) throw badRequest('结束时间不能早于开始时间');
    if (endAt - startAt > MAX_DURATION_MS) throw badRequest('时长不能超过 24 小时');
    if (endAt > now + FUTURE_TOLERANCE_MS) throw badRequest('结束时间不能晚于现在');
  }
  if (type !== 'breastfeed') return { endAt, payload };

  const segments = [...(payload as CarePayloadMap['breastfeed']).segments].sort((a, b) => a.startAt - b.startAt);
  segments.forEach((s, i) => {
    if (s.endAt !== null && s.endAt < s.startAt) throw badRequest('分段结束时间不能早于开始时间');
    if (s.endAt === null && i !== segments.length - 1) throw badRequest('只有最后一段可以进行中');
  });
  const last = segments[segments.length - 1];
  if (endAt !== null && last && last.endAt === null) {
    segments[segments.length - 1] = { ...last, endAt: Math.max(endAt, last.startAt) };
  }
  return { endAt, payload: { segments } };
}

async function findById(db: Db, id: number): Promise<CareRecord | null> {
  const rows = await baseQuery(db)
    .where(and(eq(careRecords.id, id), isNull(careRecords.deletedAt)))
    .limit(1);
  return rows[0] ? toDto(rows[0].r, rows[0].name) : null;
}

async function findRunning(db: Db, type?: CareType): Promise<CareRecord[]> {
  const rows = await baseQuery(db)
    .where(type ? eq(careRecords.runningType, type) : isNotNull(careRecords.runningType))
    .orderBy(desc(careRecords.startAt));
  return mapRows(rows);
}

async function timerConflict(db: Db, type: CareType): Promise<AppError> {
  const [record] = await findRunning(db, type);
  return new AppError(409, 'TIMER_RUNNING', '已有进行中的同类计时', { record });
}

export async function createRecord(
  db: Db,
  user: AuthUser,
  input: z.infer<typeof createBody>,
  now = Date.now(),
): Promise<{ record: CareRecord; created: boolean }> {
  const payload = parsePayload(input.type, input.payload);
  const fixed = normalize(input.type, input.startAt, input.endAt ?? null, payload, now);
  try {
    const [{ id }] = await db
      .insert(careRecords)
      .values({
        clientId: input.clientId,
        type: input.type,
        startAt: input.startAt,
        endAt: fixed.endAt,
        payload: fixed.payload,
        note: input.note ?? null,
        createdBy: user.id,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      })
      .$returningId();
    return { record: (await findById(db, id))!, created: true };
  } catch (err) {
    // 幂等：同一个 clientId 重复提交时直接返回已有记录
    if (isDuplicateKey(err, 'uk_client_id')) {
      const rows = await baseQuery(db).where(eq(careRecords.clientId, input.clientId)).limit(1);
      if (rows[0]) return { record: toDto(rows[0].r, rows[0].name), created: false };
    }
    if (isDuplicateKey(err, 'uk_running_type')) throw await timerConflict(db, input.type);
    throw err;
  }
}

export async function updateRecord(
  db: Db,
  user: AuthUser,
  id: number,
  input: z.infer<typeof updateBody>,
  now = Date.now(),
): Promise<CareRecord> {
  const existing = await findById(db, id);
  if (!existing) throw notFound();
  const startAt = input.startAt ?? existing.startAt;
  const endAt = input.endAt === undefined ? existing.endAt : input.endAt;
  const payload = input.payload === undefined ? existing.payload : parsePayload(existing.type, input.payload);
  const fixed = normalize(existing.type, startAt, endAt, payload, now);
  try {
    await db
      .update(careRecords)
      .set({
        startAt,
        endAt: fixed.endAt,
        payload: fixed.payload,
        ...(input.note !== undefined && { note: input.note }),
        updatedBy: user.id,
        updatedAt: now,
      })
      .where(eq(careRecords.id, id));
  } catch (err) {
    if (isDuplicateKey(err, 'uk_running_type')) throw await timerConflict(db, existing.type);
    throw err;
  }
  return (await findById(db, id))!;
}

export async function deleteRecord(db: Db, user: AuthUser, id: number, now = Date.now()): Promise<void> {
  const [res] = await db
    .update(careRecords)
    .set({ deletedAt: now, updatedBy: user.id, updatedAt: now })
    .where(and(eq(careRecords.id, id), isNull(careRecords.deletedAt)));
  if (res.affectedRows === 0) throw notFound();
}

export async function listRecords(db: Db, q: { from: number; to: number; type?: CareType }): Promise<CareRecord[]> {
  if (q.to <= q.from) throw badRequest('to 必须大于 from');
  if (q.to - q.from > 31 * DAY_MS) throw badRequest('时间范围不能超过 31 天');
  const rows = await baseQuery(db)
    .where(
      and(
        isNull(careRecords.deletedAt),
        gte(careRecords.startAt, q.from),
        lt(careRecords.startAt, q.to),
        q.type ? eq(careRecords.type, q.type) : undefined,
      ),
    )
    .orderBy(desc(careRecords.startAt), desc(careRecords.id))
    .limit(1000);
  return mapRows(rows);
}

export async function lastRecord(db: Db, types: CareType[]): Promise<CareRecord | null> {
  const rows = await baseQuery(db)
    .where(and(isNull(careRecords.deletedAt), inArray(careRecords.type, types)))
    .orderBy(desc(careRecords.startAt), desc(careRecords.id))
    .limit(1);
  return rows[0] ? toDto(rows[0].r, rows[0].name) : null;
}

export const runningRecords = (db: Db) => findRunning(db);

export async function medicineNames(db: Db): Promise<MedicineName[]> {
  const rows = await db
    .select({ startAt: careRecords.startAt, payload: careRecords.payload })
    .from(careRecords)
    .where(and(isNull(careRecords.deletedAt), eq(careRecords.type, 'medicine')))
    .orderBy(desc(careRecords.startAt))
    .limit(300);
  const seen = new Map<string, MedicineName>();
  for (const r of rows) {
    const p = r.payload as CarePayloadMap['medicine'];
    if (!seen.has(p.name)) seen.set(p.name, { name: p.name, dose: p.dose, unit: p.unit, lastAt: r.startAt });
  }
  return [...seen.values()].slice(0, 20);
}

/** 某一天（北京时间）的记录：当天开始的记录，以及前一天开始、可能跨过 0 点的计时类记录 */
export async function dayRecords(db: Db, date: string): Promise<{ inDay: CareRecord[]; overlapping: CareRecord[] }> {
  const dayStart = dayStartFromKey(date);
  const dayEnd = dayStart + DAY_MS;
  const rows = await baseQuery(db)
    .where(and(isNull(careRecords.deletedAt), gte(careRecords.startAt, dayStart - MAX_DURATION_MS), lt(careRecords.startAt, dayEnd)))
    .orderBy(desc(careRecords.startAt), desc(careRecords.id));
  const all = mapRows(rows);
  return {
    inDay: all.filter((r) => r.startAt >= dayStart),
    overlapping: all.filter((r) => r.startAt < dayStart && isTimerType(r.type)),
  };
}

export function computeSummary(
  date: string,
  records: { inDay: CareRecord[]; overlapping: CareRecord[] },
  now = Date.now(),
): DaySummary {
  const dayStart = dayStartFromKey(date);
  const dayEnd = dayStart + DAY_MS;
  const overlapMs = (r: CareRecord) =>
    Math.max(0, Math.min(r.endAt ?? Math.min(now, dayEnd), dayEnd) - Math.max(r.startAt, dayStart));

  const s: DaySummary = {
    date,
    bottle: { count: 0, totalMl: 0 },
    breastfeed: { count: 0, totalMs: 0 },
    diaper: { count: 0, pee: 0, poo: 0 },
    sleep: { count: 0, totalMs: 0 },
    pump: { count: 0, totalMl: 0 },
    temperature: { count: 0, maxCelsius: null },
    medicine: { count: 0 },
    bath: { count: 0 },
  };
  for (const r of records.overlapping) {
    if (r.type === 'sleep') s.sleep.totalMs += overlapMs(r);
    if (r.type === 'breastfeed') s.breastfeed.totalMs += overlapMs(r);
  }
  for (const r of records.inDay) {
    switch (r.type) {
      case 'bottle':
        s.bottle.count++;
        s.bottle.totalMl += r.payload.amountMl;
        break;
      case 'breastfeed':
        s.breastfeed.count++;
        s.breastfeed.totalMs += overlapMs(r);
        break;
      case 'diaper':
        s.diaper.count++;
        if (r.payload.kind !== 'poo') s.diaper.pee++;
        if (r.payload.kind !== 'pee') s.diaper.poo++;
        break;
      case 'sleep':
        s.sleep.count++;
        s.sleep.totalMs += overlapMs(r);
        break;
      case 'pump':
        s.pump.count++;
        s.pump.totalMl += r.payload.totalMl;
        break;
      case 'temperature':
        s.temperature.count++;
        s.temperature.maxCelsius = Math.max(s.temperature.maxCelsius ?? 0, r.payload.celsius);
        break;
      case 'medicine':
        s.medicine.count++;
        break;
      case 'bath':
        s.bath.count++;
        break;
    }
  }
  return s;
}
