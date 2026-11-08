import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';
import { ZodError } from 'zod';
import { isTransientDbError } from '../db/client';
import { AppError } from '../lib/errors';

// 统一错误响应：HTTP 状态码 + { error: { code, message } }
export default fp(async function errorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message }, ...err.extra });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const first = err.validation[0];
      const path = first?.instancePath ? `${first.instancePath.replace(/^\//, '').replaceAll('/', '.')}：` : '';
      return reply
        .status(400)
        .send({ error: { code: 'VALIDATION_ERROR', message: `参数错误（${err.validationContext}）${path}${first?.message ?? ''}` } });
    }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: { code: 'VALIDATION_ERROR', message: `参数错误：${err.issues[0]?.message ?? ''}` } });
    }
    if (isTransientDbError(err)) {
      request.log.warn({ err }, 'database unavailable');
      return reply.status(503).send({ error: { code: 'DB_UNAVAILABLE', message: '数据库正在唤醒，请稍后重试' } });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'INTERNAL_ERROR', message: '服务器开小差了，请稍后重试' } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
  });
});
