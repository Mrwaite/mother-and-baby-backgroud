import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DAD, MOM, as, setupTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const mom = () => as(ctx.app, MOM);
const dad = () => as(ctx.app, DAD);

async function createDiaper(quantity = 10, lowThreshold = 5) {
  const res = await mom().post('/inventory/items', { name: '纸尿裤', category: 'diaper', spec: 'S', unit: '片', lowThreshold, quantity });
  expect(res.status).toBe(201);
  return res.body as { id: number };
}

describe('耗材库存', () => {
  it('新建时的初始库存记为盘点流水', async () => {
    const item = await createDiaper(10);
    const logs = await mom().get(`/inventory/items/${item.id}/logs`);
    expect(logs.body).toHaveLength(1);
    expect(logs.body[0]).toMatchObject({ action: 'adjust', delta: 10, quantityBefore: 0, quantityAfter: 10, note: '初始库存', createdByName: '妈妈' });
  });

  it('入库 / 出库 / 盘点，出库不能扣成负数', async () => {
    const item = await createDiaper(10);
    const inRes = await mom().post(`/inventory/items/${item.id}/logs`, { action: 'in', quantity: 84, priceCents: 12900, channel: '京东' });
    expect(inRes.body.item.quantity).toBe(94);
    expect(inRes.body.log).toMatchObject({ delta: 84, priceCents: 12900, channel: '京东' });

    const out = await dad().post(`/inventory/items/${item.id}/logs`, { action: 'out', quantity: 4, priceCents: 100 });
    expect(out.body.item.quantity).toBe(90);
    expect(out.body.log.priceCents).toBeNull();

    const tooMany = await dad().post(`/inventory/items/${item.id}/logs`, { action: 'out', quantity: 91 });
    expect(tooMany.status).toBe(409);
    expect(tooMany.body.error.code).toBe('INSUFFICIENT_STOCK');

    const adjust = await mom().post(`/inventory/items/${item.id}/logs`, { action: 'adjust', quantity: 85 });
    expect(adjust.body.log).toMatchObject({ delta: -5, quantityBefore: 90, quantityAfter: 85 });

    const zero = await mom().post(`/inventory/items/${item.id}/logs`, { action: 'in', quantity: 0 });
    expect(zero.status).toBe(400);
  });

  it('并发出库按行锁串行，库存不会错乱', async () => {
    const item = await createDiaper(8);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => (i % 2 ? mom() : dad()).post(`/inventory/items/${item.id}/logs`, { action: 'out', quantity: 1 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(8);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    const after = await mom().get(`/inventory/items/${item.id}`);
    expect(after.body.quantity).toBe(0);

    const logs = await mom().get(`/inventory/items/${item.id}/logs?limit=100`);
    const outs = logs.body.filter((l: { action: string }) => l.action === 'out');
    expect(outs.map((l: { quantityAfter: number }) => l.quantityAfter).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('低库存提示、归档、流水分页', async () => {
    const item = await createDiaper(6, 5);
    expect((await mom().get('/dashboard')).body.lowStockCount).toBe(0);

    await mom().post(`/inventory/items/${item.id}/logs`, { action: 'out', quantity: 1 });
    const dash = await mom().get('/dashboard');
    expect(dash.body.lowStockCount).toBe(1);
    expect(dash.body.lowStockItems[0]).toMatchObject({ name: '纸尿裤', spec: 'S', quantity: 5, unit: '片' });
    expect((await mom().get(`/inventory/items/${item.id}`)).body.low).toBe(true);

    const archived = await mom().put(`/inventory/items/${item.id}`, { archived: true, spec: 'M' });
    expect(archived.body).toMatchObject({ archived: true, spec: 'M', quantity: 5 });
    expect((await mom().get('/inventory/items')).body).toHaveLength(0);
    expect((await mom().get('/inventory/items?archived=true')).body).toHaveLength(1);
    expect((await mom().get('/dashboard')).body.lowStockCount).toBe(0);

    for (let i = 0; i < 3; i++) await mom().post(`/inventory/items/${item.id}/logs`, { action: 'in', quantity: 1 });
    const page1 = await mom().get(`/inventory/items/${item.id}/logs?limit=2`);
    expect(page1.body).toHaveLength(2);
    const page2 = await mom().get(`/inventory/items/${item.id}/logs?limit=10&before=${page1.body[1].id}`);
    expect(page2.body).toHaveLength(3);
    expect(page2.body[0].id).toBeLessThan(page1.body[1].id);
  });

  it('不存在的耗材返回 404', async () => {
    expect((await mom().get('/inventory/items/999')).status).toBe(404);
    expect((await mom().post('/inventory/items/999/logs', { action: 'in', quantity: 1 })).status).toBe(404);
  });
});
