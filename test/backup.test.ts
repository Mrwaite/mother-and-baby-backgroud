import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BACKUP_PREFIX, decodeBackup, restoreDatabase, runBackup } from '../src/jobs/backup';
import { MOM, as, setupTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const silent = { info() {}, warn() {}, error() {} };

async function seed() {
  const mom = as(ctx.app, MOM);
  await mom.put('/baby', { nickname: '小米 🍼', gender: 'female', birthDate: '2026-01-01', birthWeightKg: 3.2 });
  await mom.post('/care-records', { clientId: randomUUID(), type: 'sleep', startAt: Date.now(), payload: {} });
  await mom.post('/care-records', {
    clientId: randomUUID(),
    type: 'medicine',
    startAt: Date.now(),
    payload: { name: '维生素D', dose: 1, unit: 'drop' },
    note: '饭后 😊',
  });
  await mom.post('/inventory/items', { name: '湿巾', category: 'wipes', unit: '包', lowThreshold: 2, quantity: 6 });
}

const countRows = async (table: string) => {
  const [rows] = (await ctx.database.db.execute(sql.raw(`SELECT COUNT(*) AS n FROM \`${table}\``))) as unknown as [{ n: number }[]];
  return Number(rows[0]!.n);
};

describe('备份与恢复', () => {
  it('每日备份写入对象存储，同一天只备份一次；可以恢复到空库', async () => {
    await seed();
    const deps = { database: ctx.database, storage: ctx.storage, log: silent };

    expect(await runBackup(deps, '2026-03-01')).toBe('done');
    expect(await runBackup(deps, '2026-03-01')).toBe('exists');
    const key = `${BACKUP_PREFIX}2026-03-01.json.gz`;
    const obj = ctx.storage.objects.get(key);
    expect(obj).toBeDefined();

    const data = decodeBackup(obj!.body);
    expect(data.tables.care_records).toHaveLength(2);
    expect(data.schemaVersion).toBeTruthy();

    // 不是空库时拒绝恢复
    await expect(restoreDatabase(ctx.database.pool, data)).rejects.toThrow('不是空的');

    for (const t of Object.keys(data.tables)) await ctx.database.db.execute(sql.raw(`TRUNCATE TABLE \`${t}\``));
    const counts = await restoreDatabase(ctx.database.pool, data);
    expect(counts).toMatchObject({ users: 3, baby: 1, care_records: 2, inventory_items: 1, inventory_logs: 1 });

    // 恢复后数据可用：emoji、JSON payload、进行中的计时约束都保留
    const me = await as(ctx.app, MOM).get('/me');
    expect(me.body.baby.nickname).toBe('小米 🍼');
    const dash = await as(ctx.app, MOM).get('/dashboard');
    expect(dash.body.running).toHaveLength(1);
    const dup = await as(ctx.app, MOM).post('/care-records', { clientId: randomUUID(), type: 'sleep', startAt: Date.now(), payload: {} });
    expect(dup.status).toBe(409);
    const meds = await as(ctx.app, MOM).get('/care-records/medicine-names');
    expect(meds.body[0].name).toBe('维生素D');
  });

  it('超过 30 天的备份会被清理', async () => {
    const deps = { database: ctx.database, storage: ctx.storage, log: silent };
    await runBackup(deps, '2026-01-01');
    await runBackup(deps, '2026-01-31');
    await runBackup(deps, '2026-02-01');
    expect([...ctx.storage.objects.keys()].sort()).toEqual([`${BACKUP_PREFIX}2026-01-31.json.gz`, `${BACKUP_PREFIX}2026-02-01.json.gz`].sort());
    expect(await countRows('backup_runs')).toBe(2);
  });
});
