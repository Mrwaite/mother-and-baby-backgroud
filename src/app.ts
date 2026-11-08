import Fastify, { LogController, type FastifyReply, type FastifyRequest } from 'fastify';
import { serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Config } from './config';
import type { Database } from './db/client';
import type { Storage } from './lib/cos';
import babyAndMe from './modules/me/routes';
import care from './modules/care/routes';
import dashboard from './modules/dashboard/routes';
import file from './modules/file/routes';
import growth from './modules/growth/routes';
import inventory from './modules/inventory/routes';
import milestone from './modules/milestone/routes';
import errorHandler from './plugins/error-handler';
import wxIdentity from './plugins/wx-identity';
import { API_PREFIX } from './shared/api';
import './types';

export interface AppDeps {
  config: Config;
  database: Database;
  storage: Storage | null;
}

// 每个请求只记一条日志：成员 id、路由、状态码、耗时，不记录请求体
class RequestLogController extends LogController {
  override incomingRequest() {}

  override requestCompleted(error: Error | null | undefined, request: FastifyRequest, reply: FastifyReply) {
    const line = {
      uid: request.user?.id,
      method: request.method,
      route: request.routeOptions.url,
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
    };
    if (error) request.log.error({ ...line, err: error }, 'request');
    else request.log.info(line, 'request');
  }
}

// 构建 Fastify 实例，测试中可直接复用并用 inject 发请求
export function buildApp({ config, database, storage }: AppDeps) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : { level: 'info' },
    logController: new RequestLogController(),
    // callContainer 请求体上限 100 KiB
    bodyLimit: 128 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  app.decorate('database', database);
  app.decorate('db', database.db);
  app.decorate('storage', storage);
  app.register(errorHandler);

  // wx.request / callContainer 的 DELETE 请求也会带 Content-Type: application/json 但没有请求体，
  // Fastify 默认会报 400，这里把空请求体当作 undefined
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    if (body === '') return done(null, undefined);
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('请求体不是合法的 JSON'), { statusCode: 400 }), undefined);
    }
  });

  // 前端用来校准计时的服务端时间
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Server-Time', String(Date.now()));
  });

  // 健康检查：不鉴权、不查库（避免阻止 MySQL 自动暂停）
  app.get('/healthz', async () => ({ ok: true }));

  app.register(
    async (api) => {
      await api.register(wxIdentity);
      await api.register(babyAndMe);
      await api.register(dashboard);
      await api.register(care);
      await api.register(growth);
      await api.register(milestone);
      await api.register(file);
      await api.register(inventory);
    },
    { prefix: API_PREFIX },
  );

  return app;
}

export type App = ReturnType<typeof buildApp>;
