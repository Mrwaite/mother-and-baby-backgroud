import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import type { Database } from './client';
import { withNamedLock } from '../lib/lock';

/**
 * 执行未应用的迁移。可能有 2 个实例同时启动（扩容、灰度），用 MySQL 命名锁串行化。
 * 打包后 import.meta.url 指向 dist/ 下的入口文件，迁移文件由构建脚本复制到 dist/migrations。
 */
export async function runMigrations(database: Database, folder = defaultMigrationsFolder()): Promise<void> {
  const ok = await withNamedLock(database.pool, 'migrate', 30, () => migrate(database.db, { migrationsFolder: folder }));
  if (!ok) throw new Error('等待迁移锁超时（30 秒）');
}

function defaultMigrationsFolder(): string {
  return fileURLToPath(new URL('./migrations', import.meta.url));
}
