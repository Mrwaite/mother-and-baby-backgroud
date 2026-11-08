import Fastify from 'fastify';
import type { Config } from './config';

// 构建 Fastify 实例，测试中可直接复用并用 inject 发请求
export function buildApp(config: Config) {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  // 健康检查：不鉴权、不查库（避免阻止 MySQL 自动暂停）
  app.get('/healthz', async () => ({ ok: true }));

  return app;
}
