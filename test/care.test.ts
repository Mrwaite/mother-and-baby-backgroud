import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dayStartFromKey, HOUR_MS, MINUTE_MS } from '../src/shared/time';
import { DAD, MOM, as, setupTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const mom = () => as(ctx.app, MOM);
const dad = () => as(ctx.app, DAD);
const record = (body: Record<string, unknown>) => ({ clientId: randomUUID(), ...body });

describe('护理记录：新增 / 幂等 / 校验', () => {
  it('新增瓶喂，同一 clientId 重复提交返回同一条', async () => {
    const body = record({ type: 'bottle', startAt: Date.now() - MINUTE_MS, payload: { milkType: 'formula', amountMl: 90 }, note: '  ' });
    const first = await mom().post('/care-records', body);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ type: 'bottle', payload: { milkType: 'formula', amountMl: 90 }, endAt: null, note: null, createdByName: '妈妈' });

    const again = await dad().post('/care-records', body);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
  });

  it('payload 按类型校验和规范化', async () => {
    const bad = await mom().post('/care-records', record({ type: 'bottle', startAt: Date.now(), payload: { milkType: 'cola', amountMl: 90 } }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('payload.milkType');

    const pump = await mom().post('/care-records', record({ type: 'pump', startAt: Date.now(), payload: { totalMl: 1, leftMl: 60, rightMl: 40 } }));
    expect(pump.body.payload.totalMl).toBe(100);

    const temp = await mom().post('/care-records', record({ type: 'temperature', startAt: Date.now(), payload: { celsius: 37.26, site: 'ear' } }));
    expect(temp.body.payload).toEqual({ celsius: 37.3, site: 'ear' });

    const diaper = await mom().post('/care-records', record({ type: 'diaper', startAt: Date.now(), payload: { kind: 'pee', pooColor: 'green' } }));
    expect(diaper.body.payload).toEqual({ kind: 'pee' });

    const point = await mom().post('/care-records', record({ type: 'bath', startAt: Date.now() - HOUR_MS, endAt: Date.now(), payload: {} }));
    expect(point.body.endAt).toBeNull();

    const future = await mom().post('/care-records', record({ type: 'bath', startAt: Date.now() + HOUR_MS, payload: {} }));
    expect(future.status).toBe(400);

    const badId = await mom().post('/care-records', { clientId: 'x', type: 'bath', startAt: Date.now(), payload: {} });
    expect(badId.status).toBe(400);
  });
});

describe('计时', () => {
  it('同类计时只能有一个进行中，结束后可以再开始', async () => {
    const start = Date.now() - 30 * MINUTE_MS;
    const sleep = await mom().post('/care-records', record({ type: 'sleep', startAt: start, payload: {} }));
    expect(sleep.status).toBe(201);
    expect(sleep.body.endAt).toBeNull();

    const dup = await dad().post('/care-records', record({ type: 'sleep', startAt: Date.now(), payload: {} }));
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('TIMER_RUNNING');
    expect(dup.body.record.id).toBe(sleep.body.id);

    // 不同类型的计时可以同时进行
    const feed = await dad().post('/care-records', record({ type: 'breastfeed', startAt: Date.now(), payload: { segments: [{ side: 'left', startAt: Date.now(), endAt: null }] } }));
    expect(feed.status).toBe(201);

    const dash = await mom().get('/dashboard');
    expect(dash.body.running.map((r: { type: string }) => r.type).sort()).toEqual(['breastfeed', 'sleep']);

    // 其他成员结束计时
    const ended = await dad().put(`/care-records/${sleep.body.id}`, { endAt: Date.now() });
    expect(ended.status).toBe(200);
    expect(ended.body.endAt).not.toBeNull();
    expect(ended.body.updatedBy).not.toBe(sleep.body.createdBy);

    const again = await mom().post('/care-records', record({ type: 'sleep', startAt: Date.now(), payload: {} }));
    expect(again.status).toBe(201);

    // 把已结束的记录改回进行中，会和新的计时冲突
    const reopen = await mom().put(`/care-records/${sleep.body.id}`, { endAt: null });
    expect(reopen.status).toBe(409);
  });

  it('亲喂换侧和结束：结束时关闭最后一段', async () => {
    const t0 = Date.now() - 20 * MINUTE_MS;
    const t1 = t0 + 8 * MINUTE_MS;
    const feed = await mom().post('/care-records', record({ type: 'breastfeed', startAt: t0, payload: { segments: [{ side: 'left', startAt: t0, endAt: null }] } }));

    const switched = await mom().put(`/care-records/${feed.body.id}`, {
      payload: { segments: [{ side: 'left', startAt: t0, endAt: t1 }, { side: 'right', startAt: t1, endAt: null }] },
    });
    expect(switched.body.payload.segments).toHaveLength(2);

    const end = Date.now();
    const ended = await mom().put(`/care-records/${feed.body.id}`, { endAt: end });
    expect(ended.body.payload.segments[1]).toEqual({ side: 'right', startAt: t1, endAt: end });

    const invalid = await mom().put(`/care-records/${feed.body.id}`, {
      payload: { segments: [{ side: 'left', startAt: t0, endAt: null }, { side: 'right', startAt: t1, endAt: end }] },
    });
    expect(invalid.status).toBe(400);
  });

  it('删除进行中的计时后可以重新开始；软删除后再删返回 404', async () => {
    const sleep = await mom().post('/care-records', record({ type: 'sleep', startAt: Date.now(), payload: {} }));
    expect((await mom().del(`/care-records/${sleep.body.id}`)).status).toBe(204);
    expect((await mom().del(`/care-records/${sleep.body.id}`)).status).toBe(404);
    expect((await mom().put(`/care-records/${sleep.body.id}`, { note: 'x' })).status).toBe(404);
    const again = await mom().post('/care-records', record({ type: 'sleep', startAt: Date.now(), payload: {} }));
    expect(again.status).toBe(201);
  });
});

describe('查询与汇总', () => {
  const day = '2026-01-10';
  const at = (h: number, m = 0) => dayStartFromKey(day) + h * HOUR_MS + m * MINUTE_MS;

  beforeEach(async () => {
    const add = (body: Record<string, unknown>) => mom().post('/care-records', record(body));
    // 前一天 22:00 开始、当天 02:00 结束的睡眠：当天算 2 小时，不计次数
    await add({ type: 'sleep', startAt: at(-2), endAt: at(2), payload: {} });
    await add({ type: 'bottle', startAt: at(3), payload: { milkType: 'formula', amountMl: 90 } });
    await add({ type: 'bottle', startAt: at(6), payload: { milkType: 'breast', amountMl: 60 } });
    await add({ type: 'breastfeed', startAt: at(9), endAt: at(9, 20), payload: { segments: [] } });
    await add({ type: 'diaper', startAt: at(4), payload: { kind: 'pee' } });
    await add({ type: 'diaper', startAt: at(5), payload: { kind: 'both', pooColor: 'yellow' } });
    await add({ type: 'sleep', startAt: at(13), endAt: at(14, 30), payload: {} });
    // 当天 23:00 开始、跨到第二天的睡眠：当天只算 1 小时
    await add({ type: 'sleep', startAt: at(23), endAt: at(25), payload: {} });
    await add({ type: 'pump', startAt: at(10), payload: { totalMl: 120 } });
    await add({ type: 'temperature', startAt: at(11), payload: { celsius: 37.5 } });
    await add({ type: 'temperature', startAt: at(12), payload: { celsius: 36.8 } });
    await add({ type: 'medicine', startAt: at(12), payload: { name: '维生素D', dose: 1, unit: 'drop' } });
    await add({ type: 'medicine', startAt: at(20), payload: { name: '益生菌', dose: 1, unit: 'sachet' } });
    await add({ type: 'medicine', startAt: at(21), payload: { name: '维生素D', dose: 2, unit: 'drop' } });
    await add({ type: 'bath', startAt: at(19), payload: {} });
  });

  it('某天的汇总', async () => {
    const res = await mom().get(`/care-records/summary?date=${day}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      date: day,
      bottle: { count: 2, totalMl: 150 },
      breastfeed: { count: 1, totalMs: 20 * MINUTE_MS },
      diaper: { count: 2, pee: 2, poo: 1 },
      sleep: { count: 2, totalMs: 2 * HOUR_MS + 1.5 * HOUR_MS + HOUR_MS },
      pump: { count: 1, totalMl: 120 },
      temperature: { count: 2, maxCelsius: 37.5 },
      medicine: { count: 3 },
      bath: { count: 1 },
    });
  });

  it('按时间范围和类型查询，按时间倒序', async () => {
    const all = await mom().get(`/care-records?from=${at(0)}&to=${at(24)}`);
    expect(all.body).toHaveLength(14);
    expect(all.body[0].startAt).toBeGreaterThanOrEqual(all.body[1].startAt);

    const bottles = await mom().get(`/care-records?from=${at(0)}&to=${at(24)}&type=bottle`);
    expect(bottles.body.map((r: { payload: { amountMl: number } }) => r.payload.amountMl)).toEqual([60, 90]);

    const tooLong = await mom().get(`/care-records?from=0&to=${at(0)}`);
    expect(tooLong.status).toBe(400);
  });

  it('同类型最近一条、历史药品', async () => {
    const last = await mom().get('/care-records/last?type=bottle');
    expect(last.body.record.payload.amountMl).toBe(60);
    const none = await mom().get('/care-records/last?type=breastfeed');
    expect(none.body.record.startAt).toBe(at(9));

    const meds = await mom().get('/care-records/medicine-names');
    expect(meds.body).toEqual([
      { name: '维生素D', dose: 2, unit: 'drop', lastAt: at(21) },
      { name: '益生菌', dose: 1, unit: 'sachet', lastAt: at(20) },
    ]);
  });
});

describe('首页看板', () => {
  it('上次喂养、今日记录', async () => {
    const now = Date.now();
    await mom().post('/care-records', record({ type: 'bottle', startAt: now - 2 * MINUTE_MS, payload: { milkType: 'formula', amountMl: 120 } }));
    await mom().post('/care-records', record({ type: 'diaper', startAt: now - MINUTE_MS, payload: { kind: 'poo' } }));
    const res = await mom().get('/dashboard');
    expect(res.status).toBe(200);
    expect(res.body.lastFeed.type).toBe('bottle');
    expect(res.body.lastDiaper.payload.kind).toBe('poo');
    expect(res.body.recent.length).toBeGreaterThan(0);
    expect(res.body.lowStockCount).toBe(0);
    expect(res.body.serverTime).toBeGreaterThan(0);
  });
});
