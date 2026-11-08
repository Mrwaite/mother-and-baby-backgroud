import { asc, eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { Db } from '../../db/client';
import { baby } from '../../db/schema';
import { badRequest } from '../../lib/errors';
import { dateKey } from '../../lib/validation';
import type { Baby, MeResponse } from '../../shared/api';
import { dateKeyOf } from '../../shared/time';

const measure = (min: number, max: number) => z.number().min(min).max(max).nullable().optional();

const babyBody = z.object({
  nickname: z.string().trim().min(1).max(32),
  gender: z.enum(['male', 'female']),
  birthDate: dateKey,
  birthHeightCm: measure(30, 70),
  birthWeightKg: measure(0.5, 7),
  birthHeadCm: measure(20, 45),
});

/** 一期只有一个宝宝：取第一行 */
export async function getBaby(db: Db): Promise<Baby | null> {
  const [row] = await db.select().from(baby).orderBy(asc(baby.id)).limit(1);
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.nickname,
    gender: row.gender,
    birthDate: row.birthDate,
    birthHeightCm: row.birthHeightCm,
    birthWeightKg: row.birthWeightKg,
    birthHeadCm: row.birthHeadCm,
  };
}

// 当前用户 + 宝宝档案
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/me', async (req): Promise<MeResponse> => ({
    user: req.user,
    baby: await getBaby(app.db),
    serverTime: Date.now(),
  }));

  app.put('/baby', { schema: { body: babyBody } }, async (req) => {
    const input = req.body;
    if (input.birthDate > dateKeyOf(Date.now())) throw badRequest('出生日期不能晚于今天');
    const now = Date.now();
    const values = {
      nickname: input.nickname,
      gender: input.gender,
      birthDate: input.birthDate,
      birthHeightCm: input.birthHeightCm ?? null,
      birthWeightKg: input.birthWeightKg ?? null,
      birthHeadCm: input.birthHeadCm ?? null,
      updatedAt: now,
    };
    const existing = await getBaby(app.db);
    if (existing) {
      await app.db.update(baby).set(values).where(eq(baby.id, existing.id));
    } else {
      await app.db.insert(baby).values({ ...values, createdAt: now });
    }
    return (await getBaby(app.db))!;
  });
};

export default routes;
