import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { users } from '../db/schema';
import { AppError } from '../lib/errors';
import type { AuthUser } from '../types';

/**
 * 身份与白名单：openid 由微信云托管网关注入 X-WX-OPENID 请求头（服务关闭公网访问，无法伪造）。
 * 每个请求都查一次 users 表，移出白名单立即生效。
 */
export default fp(async function wxIdentity(app: FastifyInstance) {
  app.decorateRequest('user', null as unknown as AuthUser);

  app.addHook('onRequest', async (request) => {
    const openid = request.headers['x-wx-openid'];
    if (typeof openid !== 'string' || openid === '') {
      throw new AppError(401, 'NO_WX_IDENTITY', '缺少微信身份，请在小程序内访问');
    }
    // 生产环境额外校验来源是微信生态（第二道防线）
    if (app.config.NODE_ENV === 'production' && !request.headers['x-wx-source']) {
      throw new AppError(401, 'NO_WX_IDENTITY', '请求来源不是微信');
    }

    // 数据库可能处于自动暂停状态，先等它唤醒（失败时由 error-handler 返回 503）
    await app.database.ensureReady();
    const [user] = await app.db
      .select({ id: users.id, displayName: users.displayName, enabled: users.enabled })
      .from(users)
      .where(eq(users.openid, openid))
      .limit(1);
    if (!user || user.enabled !== 1) {
      throw new AppError(403, 'NOT_WHITELISTED', '暂无访问权限，请把 openid 发给管理员', { openid });
    }
    request.user = { id: user.id, displayName: user.displayName, openid };
  });
});
