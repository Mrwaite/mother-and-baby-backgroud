import { existsSync } from 'node:fs';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createDatabase, withDbRetry } from './db/client';
import { runMigrations } from './db/migrate';
import { startBackupScheduler } from './jobs/backup';
import { createCosStorage } from './lib/cos';

// 本地开发读取 .env；云托管上的环境变量在「服务设置」中配置
if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');

const config = loadConfig();
const database = createDatabase(config);
const storage = config.cos ? createCosStorage(config.cos) : null;
const app = buildApp({ config, database, storage });

let stopBackup: (() => void) | null = null;

// 云托管下线实例时会发送 SIGTERM，先处理完进行中的请求再退出
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    stopBackup?.();
    void app
      .close()
      .then(() => database.close())
      .finally(() => process.exit(0));
  });
}

try {
  // 数据库可能正处于自动暂停，迁移前先等它唤醒
  await withDbRetry(() => runMigrations(database));
  await app.listen({ host: '0.0.0.0', port: config.PORT });
  if (storage && config.backupEnabled) {
    stopBackup = startBackupScheduler({ database, storage, log: app.log });
  } else {
    app.log.info('daily backup disabled');
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
