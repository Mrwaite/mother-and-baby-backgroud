import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';
import type { Config } from '../config';
import * as schema from './schema';

export type Db = MySql2Database<typeof schema>;

export interface Database {
  pool: mysql.Pool;
  db: Db;
  /** 拿一个可用连接（带数据库唤醒重试）后立即归还，保证后续查询能用上热连接 */
  ensureReady(): Promise<void>;
  close(): Promise<void>;
}

export function createDatabase(config: Config): Database {
  const pool = mysql.createPool({
    ...config.mysql,
    connectionLimit: 5,
    maxIdle: 5,
    // 空闲连接 1 分钟内释放，避免数据库自动暂停后池里留着失效连接
    idleTimeout: 60_000,
    enableKeepAlive: true,
    connectTimeout: 5_000,
    charset: 'utf8mb4_0900_ai_ci',
    // DECIMAL 以字符串返回，由 Drizzle 的 mode: 'number' 转换
    supportBigNumbers: true,
  });
  const db = drizzle(pool, { schema, mode: 'default' });

  return {
    pool,
    db,
    ensureReady: () =>
      withDbRetry(async () => {
        const conn = await pool.getConnection();
        try {
          await conn.ping();
          conn.release();
        } catch (err) {
          conn.destroy();
          throw err;
        }
      }),
    close: () => pool.end(),
  };
}

/** 沿 cause 链找到 mysql2 抛出的原始错误 */
export function mysqlErrorOf(err: unknown): { code?: string; errno?: number; message: string } | null {
  let cur: unknown = err;
  for (let i = 0; i < 5 && cur; i++) {
    const e = cur as { code?: unknown; errno?: unknown; message?: unknown; cause?: unknown };
    if (typeof e.code === 'string' || typeof e.errno === 'number') {
      return { code: e.code as string | undefined, errno: e.errno as number | undefined, message: String(e.message ?? '') };
    }
    cur = e.cause;
  }
  return null;
}

const TRANSIENT_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'PROTOCOL_SEQUENCE_TIMEOUT',
  'ER_CON_COUNT_ERROR',
]);

/** 数据库暂停唤醒、连接断开等可以重试的错误 */
export function isTransientDbError(err: unknown): boolean {
  const e = mysqlErrorOf(err);
  if (!e) return false;
  return (e.code !== undefined && TRANSIENT_CODES.has(e.code)) || /resuming|try connecting again/i.test(e.message);
}

/** 唯一键冲突，可选匹配键名 */
export function isDuplicateKey(err: unknown, keyName?: string): boolean {
  const e = mysqlErrorOf(err);
  if (!e || e.code !== 'ER_DUP_ENTRY') return false;
  return keyName === undefined || e.message.includes(keyName);
}

const RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

/** Serverless MySQL 唤醒期间按 0.5s、1s、2s、4s 退避重试（总等待约 7.5s，留出 callContainer 15s 超时余量） */
export async function withDbRetry<T>(fn: () => Promise<T>, delays: number[] = RETRY_DELAYS_MS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= delays.length || !isTransientDbError(err)) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
