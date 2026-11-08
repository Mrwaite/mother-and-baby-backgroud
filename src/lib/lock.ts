import type { Pool, RowDataPacket } from 'mysql2/promise';

/**
 * 在 MySQL 命名锁内执行 fn（锁与连接绑定，所以独占一个连接直到释放）。
 * timeoutSec 为 0 时拿不到锁立即返回 false，不执行 fn。
 */
export async function withNamedLock(
  pool: Pool,
  name: string,
  timeoutSec: number,
  fn: () => Promise<unknown>,
): Promise<boolean> {
  const conn = await pool.getConnection();
  try {
    const [rows] = await conn.query<RowDataPacket[]>('SELECT GET_LOCK(?, ?) AS ok', [name, timeoutSec]);
    if (rows[0]?.ok !== 1) return false;
    try {
      await fn();
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [name]);
    }
    return true;
  } finally {
    conn.release();
  }
}
