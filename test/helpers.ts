import { sql } from 'drizzle-orm';
import { inject } from 'vitest';
import { buildApp, type App } from '../src/app';
import { loadConfig } from '../src/config';
import { createDatabase, type Database } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { users } from '../src/db/schema';
import { createMemoryStorage } from '../src/lib/cos';

export const MOM = 'openid-mom';
export const DAD = 'openid-dad';
export const DISABLED = 'openid-disabled';
export const STRANGER = 'openid-stranger';
export const FILE_PREFIX = 'cloud://test-env.test-bucket/';

const TABLES = [
  'users',
  'baby',
  'care_records',
  'growth_records',
  'milestones',
  'files',
  'milestone_photos',
  'inventory_items',
  'inventory_logs',
  'backup_runs',
];

export interface TestContext {
  app: App;
  database: Database;
  storage: ReturnType<typeof createMemoryStorage>;
  /** 清空所有表并重新写入白名单成员 */
  reset(): Promise<void>;
  close(): Promise<void>;
}

export async function setupTestApp(): Promise<TestContext> {
  const m = inject('mysql');
  const config = loadConfig({
    NODE_ENV: 'test',
    MYSQL_ADDRESS: m.address,
    MYSQL_USERNAME: m.user,
    MYSQL_PASSWORD: m.password,
    MYSQL_DATABASE: m.database,
  });
  const database = createDatabase(config);
  await runMigrations(database);
  const storage = createMemoryStorage(FILE_PREFIX);
  const app = buildApp({ config, database, storage });
  await app.ready();

  return {
    app,
    database,
    storage,
    async reset() {
      for (const t of TABLES) await database.db.execute(sql.raw(`TRUNCATE TABLE \`${t}\``));
      storage.objects.clear();
      const now = Date.now();
      await database.db.insert(users).values([
        { openid: MOM, displayName: '妈妈', enabled: 1, createdAt: now, updatedAt: now },
        { openid: DAD, displayName: '爸爸', enabled: 1, createdAt: now, updatedAt: now },
        { openid: DISABLED, displayName: '外婆', enabled: 0, createdAt: now, updatedAt: now },
      ]);
    },
    async close() {
      await app.close();
      await database.close();
    },
  };
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

/** 以某个成员身份发请求（模拟云托管网关注入的 X-WX-OPENID） */
export function as(app: App, openid: string | null) {
  const send = async (method: Method, url: string, payload?: unknown) => {
    const res = await app.inject({
      method,
      url: `/api/v1${url}`,
      headers: openid ? { 'x-wx-openid': openid } : {},
      ...(payload !== undefined && { payload: payload as object }),
    });
    return { status: res.statusCode, body: res.body ? res.json() : undefined, headers: res.headers };
  };
  return {
    get: (url: string) => send('GET', url),
    post: (url: string, body: unknown) => send('POST', url, body),
    put: (url: string, body: unknown) => send('PUT', url, body),
    del: (url: string) => send('DELETE', url),
  };
}
