import type { ErrorCode } from '../shared/api';

/** 业务错误：由 error-handler 转换为 HTTP 状态码 + { error: { code, message }, ...extra } */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const notFound = (what = '记录') => new AppError(404, 'NOT_FOUND', `${what}不存在或已删除`);

export const badRequest = (message: string) => new AppError(400, 'VALIDATION_ERROR', message);
