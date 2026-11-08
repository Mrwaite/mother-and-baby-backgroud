import { gunzipSync, gzipSync } from 'node:zlib';
import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client';
import { BUSINESS_TABLES } from '../db/schema';
import type { Storage } from '../lib/cos';
import { withNamedLock } from '../lib/lock';
import { DAY_MS, MINUTE_MS, TZ_OFFSET_MS, addDays, dateKeyOf } from '../shared/time';

export const BACKUP_PREFIX = 'backups/db/';
const RETENTION_DAYS = 30;
const BACKUP_HOUR = 3;
const TABLE_NAMES = Object.keys(BUSINESS_TABLES);
/** 恢复时跳过的生成列 */
const GENERATED_COLUMNS: Record<string, string[]> = { care_records: ['running_type'] };

export interface BackupData {
  format: 'mother-baby-backup';
  version: 1;
  /** 备份时最后一次迁移的 hash，恢复前确认表结构一致 */
  schemaVersion: string | null;
  createdAt: number;
  tables: Record<string, Record<string, unknown>[]>;
}

/** 在一致性快照中读出所有业务表 */
export async function exportDatabase(pool: Pool): Promise<BackupData> {
  const conn = await pool.getConnection();
  try {
    await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    const tables: BackupData['tables'] = {};
    for (const name of TABLE_NAMES) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM \`${name}\``);
      tables[name] = rows.map((r) => ({ ...r }));
    }
    const schemaVersion = await currentSchemaVersion(conn);
    await conn.query('COMMIT');
    return { format: 'mother-baby-backup', version: 1, schemaVersion, createdAt: Date.now(), tables };
  } finally {
    conn.release();
  }
}

async function currentSchemaVersion(conn: PoolConnection): Promise<string | null> {
  const [rows] = await conn.query<RowDataPacket[]>(
    'SELECT hash FROM `__drizzle_migrations` ORDER BY created_at DESC, id DESC LIMIT 1',
  );
  return (rows[0]?.hash as string | undefined) ?? null;
}

export const encodeBackup = (data: BackupData) => gzipSync(JSON.stringify(data));

export function decodeBackup(buf: Buffer): BackupData {
  const data = JSON.parse(gunzipSync(buf).toString('utf8')) as BackupData;
  if (data.format !== 'mother-baby-backup' || data.version !== 1) throw new Error('不是有效的备份文件');
  return data;
}

/** 把备份导入空库（表结构需已通过迁移建好） */
export async function restoreDatabase(pool: Pool, data: BackupData): Promise<Record<string, number>> {
  const conn = await pool.getConnection();
  try {
    const schemaVersion = await currentSchemaVersion(conn);
    if (data.schemaVersion !== schemaVersion) {
      throw new Error(`表结构版本不一致：备份 ${data.schemaVersion}，当前库 ${schemaVersion}`);
    }
    for (const name of TABLE_NAMES) {
      const [rows] = await conn.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM \`${name}\``);
      if (Number(rows[0]?.n) > 0) throw new Error(`表 ${name} 不是空的，只能恢复到空库`);
    }

    const counts: Record<string, number> = {};
    await conn.beginTransaction();
    try {
      for (const name of TABLE_NAMES) {
        const rows = data.tables[name] ?? [];
        counts[name] = rows.length;
        if (rows.length === 0) continue;
        const skip = GENERATED_COLUMNS[name] ?? [];
        const columns = Object.keys(rows[0]!).filter((c) => !skip.includes(c));
        const values = rows.map((r) =>
          columns.map((c) => {
            const v = r[c];
            // JSON 列需要序列化，否则 mysql2 会把对象展开成 key = value
            return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
          }),
        );
        for (let i = 0; i < values.length; i += 500) {
          await conn.query(`INSERT INTO \`${name}\` (${columns.map((c) => `\`${c}\``).join(', ')}) VALUES ?`, [
            values.slice(i, i + 500),
          ]);
        }
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    }
    return counts;
  } finally {
    conn.release();
  }
}

export interface BackupDeps {
  database: Database;
  storage: Storage;
  log: Pick<FastifyBaseLogger, 'info' | 'warn' | 'error'>;
}

/**
 * 执行某天的备份：多实例用 GET_LOCK 去重，backup_runs.date 唯一索引兜底。
 * 返回 'done' | 'exists' | 'locked'
 */
export async function runBackup(deps: BackupDeps, date: string, now = Date.now()): Promise<'done' | 'exists' | 'locked'> {
  const { pool } = deps.database;
  let result: 'done' | 'exists' = 'exists';
  const locked = await withNamedLock(pool, 'backup', 0, async () => {
    const [existing] = await pool.query<RowDataPacket[]>('SELECT id FROM backup_runs WHERE date = ?', [date]);
    if (existing.length > 0) return;

    const body = encodeBackup(await exportDatabase(pool));
    const key = `${BACKUP_PREFIX}${date}.json.gz`;
    await deps.storage.putObject(key, body, 'application/gzip');
    await pool.query('INSERT INTO backup_runs (date, cos_key, size, created_at) VALUES (?, ?, ?, ?)', [date, key, body.length, now]);
    deps.log.info({ key, size: body.length }, 'backup done');
    result = 'done';

    await cleanupOldBackups(deps, date);
  });
  return locked ? result : 'locked';
}

/** 删除超过保留期的备份 */
async function cleanupOldBackups(deps: BackupDeps, today: string) {
  const { pool } = deps.database;
  const cutoff = addDays(today, -RETENTION_DAYS);
  const [rows] = await pool.query<RowDataPacket[]>('SELECT id, cos_key FROM backup_runs WHERE date < ?', [cutoff]);
  for (const r of rows) {
    try {
      await deps.storage.deleteObject(r.cos_key as string);
      await pool.query('DELETE FROM backup_runs WHERE id = ?', [r.id]);
    } catch (err) {
      deps.log.warn({ err, key: r.cos_key }, 'delete old backup failed');
    }
  }
}

/**
 * 进程内定时器：每 10 分钟检查一次，北京时间过了 03:00 且今天还没备份时才去查库，
 * 平时不碰数据库（不影响 MySQL 自动暂停）。
 */
export function startBackupScheduler(deps: BackupDeps, intervalMs = 10 * MINUTE_MS): () => void {
  let doneDate: string | null = null;
  let running = false;

  const tick = async () => {
    const now = Date.now();
    const today = dateKeyOf(now);
    const hour = Math.floor(((now + TZ_OFFSET_MS) % DAY_MS) / (60 * MINUTE_MS));
    if (running || doneDate === today || hour < BACKUP_HOUR) return;
    running = true;
    try {
      const result = await runBackup(deps, today, now);
      // 被其他实例锁住时，下次再查一次 backup_runs 即可确认
      if (result !== 'locked') doneDate = today;
    } catch (err) {
      deps.log.error({ err }, 'backup failed');
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
