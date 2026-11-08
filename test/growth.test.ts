import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FILE_PREFIX, MOM, as, setupTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

const mom = () => as(ctx.app, MOM);

/** 模拟小程序已经 wx.cloud.uploadFile 上传了一张图片 */
function uploaded(name = `${randomUUID()}.jpg`, size = 1000, mime = 'image/jpeg') {
  const key = `milestones/2026-01/${name}`;
  ctx.storage.objects.set(key, { body: Buffer.alloc(size), mime });
  return FILE_PREFIX + key;
}

describe('生长测量', () => {
  it('增删改查，至少填一项', async () => {
    const empty = await mom().post('/growth-records', { measureDate: '2026-02-01' });
    expect(empty.status).toBe(400);

    const a = await mom().post('/growth-records', { measureDate: '2026-02-01', heightCm: 52.3, weightKg: 3.85 });
    expect(a.status).toBe(201);
    expect(a.body).toMatchObject({ heightCm: 52.3, weightKg: 3.85, headCm: null });
    await mom().post('/growth-records', { measureDate: '2026-03-01', headCm: 38 });

    const list = await mom().get('/growth-records');
    expect(list.body.map((r: { measureDate: string }) => r.measureDate)).toEqual(['2026-03-01', '2026-02-01']);

    const updated = await mom().put(`/growth-records/${a.body.id}`, { weightKg: 4.1, note: '体检' });
    expect(updated.body).toMatchObject({ heightCm: 52.3, weightKg: 4.1, note: '体检' });

    const cleared = await mom().put(`/growth-records/${a.body.id}`, { heightCm: null, weightKg: null });
    expect(cleared.status).toBe(400);

    expect((await mom().del(`/growth-records/${a.body.id}`)).status).toBe(204);
    expect((await mom().get('/growth-records')).body).toHaveLength(1);
  });
});

describe('照片登记', () => {
  it('校验文件 ID 前缀、存在性、大小和类型', async () => {
    const other = await mom().post('/files', { fileId: 'cloud://other-env.bucket/milestones/a.jpg' });
    expect(other.body.error.code).toBe('INVALID_FILE');

    const missing = await mom().post('/files', { fileId: `${FILE_PREFIX}milestones/2026-01/none.jpg` });
    expect(missing.status).toBe(400);

    const big = await mom().post('/files', { fileId: uploaded(undefined, 11 * 1024 * 1024) });
    expect(big.status).toBe(400);

    const notImage = await mom().post('/files', { fileId: uploaded('a.jpg', 100, 'text/html') });
    expect(notImage.status).toBe(400);

    const traversal = await mom().post('/files', { fileId: `${FILE_PREFIX}milestones/../backups/db/x.jpg` });
    expect(traversal.status).toBe(400);

    const fileId = uploaded();
    const ok = await mom().post('/files', { fileId });
    expect(ok.status).toBe(201);
    expect(ok.body.fileId).toBe(fileId);

    const again = await mom().post('/files', { fileId });
    expect(again.body.id).toBe(ok.body.id);
  });
});

describe('里程碑', () => {
  const register = async () => (await mom().post('/files', { fileId: uploaded() })).body as { id: string; fileId: string };

  it('带照片新增、调整照片、删除', async () => {
    const [p1, p2, p3] = [await register(), await register(), await register()];
    const created = await mom().post('/milestones', { date: '2026-03-01', title: '第一次翻身', photoIds: [p2.id, p1.id] });
    expect(created.status).toBe(201);
    expect(created.body.photos).toEqual([p2, p1]);

    const updated = await mom().put(`/milestones/${created.body.id}`, { photoIds: [p3.id, p2.id], description: '在床上' });
    expect(updated.body.photos).toEqual([p3, p2]);
    expect(updated.body.description).toBe('在床上');

    // 被移除的照片软删除，不能再被引用
    const reuse = await mom().post('/milestones', { date: '2026-03-02', title: '抬头', photoIds: [p1.id] });
    expect(reuse.status).toBe(400);

    await mom().post('/milestones', { date: '2026-03-05', title: '独坐' });
    const list = await mom().get('/milestones');
    expect(list.body.map((m: { title: string }) => m.title)).toEqual(['独坐', '第一次翻身']);

    expect((await mom().del(`/milestones/${created.body.id}`)).status).toBe(204);
    expect((await mom().get(`/milestones/${created.body.id}`)).status).toBe(404);
  });

  it('最多 9 张照片', async () => {
    const ids = Array.from({ length: 10 }, () => randomUUID());
    const res = await mom().post('/milestones', { date: '2026-03-01', title: '走路', photoIds: ids });
    expect(res.status).toBe(400);
  });
});
