import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DAD, DISABLED, MOM, STRANGER, as, setupTestApp, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => {
  ctx = await setupTestApp();
});
afterAll(() => ctx.close());
beforeEach(() => ctx.reset());

describe('身份与白名单', () => {
  it('/healthz 不需要身份', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('没有 X-WX-OPENID 返回 401', async () => {
    const res = await as(ctx.app, null).get('/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('NO_WX_IDENTITY');
  });

  it('不在白名单返回 403 并带上 openid', async () => {
    const res = await as(ctx.app, STRANGER).get('/me');
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ error: { code: 'NOT_WHITELISTED' }, openid: STRANGER });
  });

  it('被禁用的成员返回 403', async () => {
    const res = await as(ctx.app, DISABLED).get('/dashboard');
    expect(res.status).toBe(403);
  });

  it('白名单成员可以访问 /me，响应带 X-Server-Time', async () => {
    const res = await as(ctx.app, MOM).get('/me');
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ displayName: '妈妈', openid: MOM });
    expect(res.body.baby).toBeNull();
    expect(Number(res.headers['x-server-time'])).toBeGreaterThan(0);
    expect(res.body.serverTime).toBeGreaterThan(0);
  });

  it('未知接口返回 404', async () => {
    const res = await as(ctx.app, MOM).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('带 JSON Content-Type 但没有请求体的 DELETE 正常处理；非法 JSON 返回 400', async () => {
    const headers = { 'x-wx-openid': MOM, 'content-type': 'application/json' };
    const del = await ctx.app.inject({ method: 'DELETE', url: '/api/v1/growth-records/1', headers });
    expect(del.statusCode).toBe(404);
    const bad = await ctx.app.inject({ method: 'POST', url: '/api/v1/growth-records', headers, payload: '{oops' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION_ERROR');
  });
});

describe('宝宝档案', () => {
  it('创建后更新，所有成员看到同一份', async () => {
    const created = await as(ctx.app, MOM).put('/baby', { nickname: '小米', gender: 'female', birthDate: '2026-01-31', birthWeightKg: 3.25 });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({ nickname: '小米', birthWeightKg: 3.25, birthHeightCm: null });

    const updated = await as(ctx.app, DAD).put('/baby', { nickname: '米粒', gender: 'female', birthDate: '2026-01-31', birthHeightCm: 50.5 });
    expect(updated.body).toMatchObject({ id: created.body.id, nickname: '米粒', birthHeightCm: 50.5, birthWeightKg: null });

    const me = await as(ctx.app, MOM).get('/me');
    expect(me.body.baby.nickname).toBe('米粒');
  });

  it('参数校验', async () => {
    const future = await as(ctx.app, MOM).put('/baby', { nickname: '小米', gender: 'female', birthDate: '2999-01-01' });
    expect(future.status).toBe(400);
    const bad = await as(ctx.app, MOM).put('/baby', { nickname: '', gender: 'x', birthDate: '2026-02-30' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });
});
