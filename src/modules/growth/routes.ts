import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { growthRecords } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { dateKey, idParams, optionalText } from '../../lib/validation';
import type { GrowthRecord } from '../../shared/api';
import { dateKeyOf } from '../../shared/time';

const measure = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

const fields = {
  measureDate: dateKey,
  heightCm: measure(30, 130),
  weightKg: measure(0.5, 40),
  headCm: measure(20, 60),
  note: optionalText(500),
};
const createBody = z.object(fields);
const updateBody = z.object(fields).partial();

type Row = typeof growthRecords.$inferSelect;

function toDto(r: Row): GrowthRecord {
  return {
    id: r.id,
    measureDate: r.measureDate,
    heightCm: r.heightCm,
    weightKg: r.weightKg,
    headCm: r.headCm,
    note: r.note,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function check(v: { measureDate: string; heightCm: number | null; weightKg: number | null; headCm: number | null }) {
  if (v.heightCm === null && v.weightKg === null && v.headCm === null) throw badRequest('身高、体重、头围至少填一项');
  if (v.measureDate > dateKeyOf(Date.now())) throw badRequest('测量日期不能晚于今天');
}

async function findById(db: Db, id: number): Promise<Row> {
  const [row] = await db
    .select()
    .from(growthRecords)
    .where(and(eq(growthRecords.id, id), isNull(growthRecords.deletedAt)))
    .limit(1);
  if (!row) throw notFound('测量记录');
  return row;
}

// 生长测量：数据量很小（每月几条），列表一次全部返回
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/growth-records', async () => {
    const rows = await app.db
      .select()
      .from(growthRecords)
      .where(isNull(growthRecords.deletedAt))
      .orderBy(desc(growthRecords.measureDate), desc(growthRecords.id));
    return rows.map(toDto);
  });

  app.post('/growth-records', { schema: { body: createBody } }, async (req, reply) => {
    const values = {
      measureDate: req.body.measureDate,
      heightCm: req.body.heightCm ?? null,
      weightKg: req.body.weightKg ?? null,
      headCm: req.body.headCm ?? null,
      note: req.body.note ?? null,
    };
    check(values);
    const now = Date.now();
    const [{ id }] = await app.db
      .insert(growthRecords)
      .values({ ...values, createdBy: req.user.id, createdAt: now, updatedAt: now })
      .$returningId();
    return reply.status(201).send(toDto(await findById(app.db, id)));
  });

  app.put('/growth-records/:id', { schema: { params: idParams, body: updateBody } }, async (req) => {
    const existing = await findById(app.db, req.params.id);
    const patch = Object.fromEntries(Object.entries(req.body).filter(([, v]) => v !== undefined)) as Partial<Row>;
    check({ ...existing, ...patch });
    await app.db
      .update(growthRecords)
      .set({ ...patch, updatedAt: Date.now() })
      .where(eq(growthRecords.id, existing.id));
    return toDto(await findById(app.db, existing.id));
  });

  app.delete('/growth-records/:id', { schema: { params: idParams } }, async (req, reply) => {
    const existing = await findById(app.db, req.params.id);
    await app.db.update(growthRecords).set({ deletedAt: Date.now() }).where(eq(growthRecords.id, existing.id));
    return reply.status(204).send();
  });
};

export default routes;
