import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { files, milestonePhotos, milestones } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { dateKey, idParams, optionalText } from '../../lib/validation';
import { MAX_MILESTONE_PHOTOS, type Milestone, type Photo } from '../../shared/api';
import { dateKeyOf } from '../../shared/time';

const fields = {
  date: dateKey,
  title: z.string().trim().min(1).max(64),
  description: optionalText(1000),
  photoIds: z
    .array(z.uuid())
    .max(MAX_MILESTONE_PHOTOS, `最多 ${MAX_MILESTONE_PHOTOS} 张照片`)
    .refine((ids) => new Set(ids).size === ids.length, '照片重复')
    .optional(),
};
const createBody = z.object(fields);
const updateBody = z.object(fields).partial();

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function photosOf(db: Db, milestoneIds: number[]): Promise<Map<number, Photo[]>> {
  const result = new Map<number, Photo[]>();
  if (milestoneIds.length === 0) return result;
  const rows = await db
    .select({ milestoneId: milestonePhotos.milestoneId, id: files.id, fileId: files.cloudFileId })
    .from(milestonePhotos)
    .innerJoin(files, eq(files.id, milestonePhotos.fileId))
    .where(and(inArray(milestonePhotos.milestoneId, milestoneIds), isNull(files.deletedAt)))
    .orderBy(asc(milestonePhotos.sort));
  for (const r of rows) {
    const list = result.get(r.milestoneId) ?? [];
    list.push({ id: r.id, fileId: r.fileId });
    result.set(r.milestoneId, list);
  }
  return result;
}

async function list(db: Db, id?: number): Promise<Milestone[]> {
  const rows = await db
    .select()
    .from(milestones)
    .where(and(isNull(milestones.deletedAt), id === undefined ? undefined : eq(milestones.id, id)))
    .orderBy(desc(milestones.date), desc(milestones.id));
  const photos = await photosOf(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    title: r.title,
    description: r.description,
    photos: photos.get(r.id) ?? [],
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  }));
}

async function getOne(db: Db, id: number): Promise<Milestone> {
  const [m] = await list(db, id);
  if (!m) throw notFound('里程碑');
  return m;
}

/** 替换里程碑的照片：校验照片已登记，移除的照片在 files 表里软删除（不删对象存储里的文件） */
async function setPhotos(tx: Tx, milestoneId: number, photoIds: string[], now: number) {
  if (photoIds.length > 0) {
    const found = await tx
      .select({ id: files.id })
      .from(files)
      .where(and(inArray(files.id, photoIds), isNull(files.deletedAt)));
    if (found.length !== photoIds.length) throw badRequest('照片不存在，请重新上传');
  }
  const current = await tx
    .select({ fileId: milestonePhotos.fileId })
    .from(milestonePhotos)
    .where(eq(milestonePhotos.milestoneId, milestoneId));
  const removed = current.map((c) => c.fileId).filter((id) => !photoIds.includes(id));
  if (removed.length > 0) await tx.update(files).set({ deletedAt: now }).where(inArray(files.id, removed));
  await tx.delete(milestonePhotos).where(eq(milestonePhotos.milestoneId, milestoneId));
  if (photoIds.length > 0) {
    await tx.insert(milestonePhotos).values(photoIds.map((fileId, sort) => ({ milestoneId, fileId, sort })));
  }
}

function checkDate(date: string) {
  if (date > dateKeyOf(Date.now())) throw badRequest('日期不能晚于今天');
}

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/milestones', () => list(app.db));

  app.get('/milestones/:id', { schema: { params: idParams } }, (req) => getOne(app.db, req.params.id));

  app.post('/milestones', { schema: { body: createBody } }, async (req, reply) => {
    const { photoIds = [], ...input } = req.body;
    checkDate(input.date);
    const now = Date.now();
    const id = await app.db.transaction(async (tx) => {
      const [{ id }] = await tx
        .insert(milestones)
        .values({
          date: input.date,
          title: input.title,
          description: input.description ?? null,
          createdBy: req.user.id,
          createdAt: now,
          updatedAt: now,
        })
        .$returningId();
      await setPhotos(tx, id, photoIds, now);
      return id;
    });
    return reply.status(201).send(await getOne(app.db, id));
  });

  app.put('/milestones/:id', { schema: { params: idParams, body: updateBody } }, async (req) => {
    const existing = await getOne(app.db, req.params.id);
    const { photoIds, ...input } = req.body;
    if (input.date) checkDate(input.date);
    const now = Date.now();
    await app.db.transaction(async (tx) => {
      await tx
        .update(milestones)
        .set({
          ...(input.date !== undefined && { date: input.date }),
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description }),
          updatedAt: now,
        })
        .where(eq(milestones.id, existing.id));
      if (photoIds) await setPhotos(tx, existing.id, photoIds, now);
    });
    return getOne(app.db, existing.id);
  });

  app.delete('/milestones/:id', { schema: { params: idParams } }, async (req, reply) => {
    const existing = await getOne(app.db, req.params.id);
    const now = Date.now();
    await app.db.transaction(async (tx) => {
      await tx.update(milestones).set({ deletedAt: now }).where(eq(milestones.id, existing.id));
      const ids = existing.photos.map((p) => p.id);
      if (ids.length > 0) await tx.update(files).set({ deletedAt: now }).where(inArray(files.id, ids));
    });
    return reply.status(204).send();
  });
};

export default routes;
