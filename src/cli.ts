import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { eq } from 'drizzle-orm';
import { loadConfig } from './config';
import { createDatabase, withDbRetry, type Database } from './db/client';
import { runMigrations } from './db/migrate';
import { users } from './db/schema';
import { decodeBackup, encodeBackup, exportDatabase, restoreDatabase, runBackup } from './jobs/backup';
import { createCosStorage } from './lib/cos';
import { dateKeyOf } from './shared/time';

// 管理命令：在云托管「实例 → WebShell」中执行 node dist/cli.js <命令>；本地用 npm run cli -- <命令>
const HELP = `用法：node dist/cli.js <命令> [参数]

白名单
  user:add --openid <openid> --name <显示名称>   添加成员（已存在则更新名称并启用）
  user:list                                       列出成员
  user:rename --openid <openid> --name <名称>     修改显示名称
  user:disable --openid <openid>                  禁用（移出白名单）
  user:enable --openid <openid>                   重新启用

数据库
  migrate                                         执行迁移
  backup:run [--out <本地文件>]                    立即备份：默认上传到对象存储；指定 --out 时写到本地文件
  backup:restore --file <对象存储 key>             从对象存储中的备份恢复到空库
  backup:restore --local <本地文件>                从本地备份文件恢复到空库
`;

if (process.env.NODE_ENV !== 'production' && existsSync('.env')) process.loadEnvFile('.env');

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    openid: { type: 'string' },
    name: { type: 'string' },
    out: { type: 'string' },
    file: { type: 'string' },
    local: { type: 'string' },
  },
});

function required(key: 'openid' | 'name'): string {
  const v = values[key]?.trim();
  if (!v) throw new Error(`缺少参数 --${key}`);
  return v;
}

async function setEnabled(database: Database, enabled: 0 | 1) {
  const openid = required('openid');
  const [res] = await database.db.update(users).set({ enabled, updatedAt: Date.now() }).where(eq(users.openid, openid));
  if (res.affectedRows === 0) throw new Error(`找不到成员：${openid}`);
  console.log(enabled ? `已启用 ${openid}` : `已禁用 ${openid}`);
}

const commands: Record<string, (database: Database) => Promise<void>> = {
  async 'user:add'(database) {
    const openid = required('openid');
    const name = required('name');
    const now = Date.now();
    await database.db
      .insert(users)
      .values({ openid, displayName: name, enabled: 1, createdAt: now, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { displayName: name, enabled: 1, updatedAt: now } });
    console.log(`已加入白名单：${name}（${openid}）`);
  },
  async 'user:list'(database) {
    const rows = await database.db.select().from(users).orderBy(users.id);
    console.table(rows.map((u) => ({ id: u.id, name: u.displayName, openid: u.openid, enabled: u.enabled === 1 })));
  },
  async 'user:rename'(database) {
    const openid = required('openid');
    const name = required('name');
    const [res] = await database.db.update(users).set({ displayName: name, updatedAt: Date.now() }).where(eq(users.openid, openid));
    if (res.affectedRows === 0) throw new Error(`找不到成员：${openid}`);
    console.log(`已改名为 ${name}`);
  },
  'user:disable': (database) => setEnabled(database, 0),
  'user:enable': (database) => setEnabled(database, 1),
  async migrate() {
    // 迁移在打开连接后统一执行，这里不需要额外操作
    console.log('迁移完成');
  },
  async 'backup:run'(database) {
    if (values.out) {
      const body = encodeBackup(await exportDatabase(database.pool));
      writeFileSync(values.out, body);
      console.log(`已写入 ${values.out}（${body.length} 字节）`);
      return;
    }
    const config = loadConfig();
    if (!config.cos) throw new Error('未配置对象存储（COS_BUCKET / CBR_ENV_ID），请用 --out 写到本地文件');
    const storage = createCosStorage(config.cos);
    const result = await runBackup({ database, storage, log: console }, dateKeyOf(Date.now()));
    console.log({ done: '备份完成', exists: '今天已经备份过', locked: '其他实例正在备份' }[result]);
  },
  async 'backup:restore'(database) {
    let buf: Buffer;
    if (values.local) {
      buf = readFileSync(values.local);
    } else if (values.file) {
      const config = loadConfig();
      if (!config.cos) throw new Error('未配置对象存储（COS_BUCKET / CBR_ENV_ID）');
      buf = await createCosStorage(config.cos).getObject(values.file);
    } else {
      throw new Error('缺少参数 --file 或 --local');
    }
    const counts = await restoreDatabase(database.pool, decodeBackup(buf));
    console.table(counts);
    console.log('恢复完成');
  },
};

async function main() {
  const name = positionals[0];
  const command = name ? commands[name] : undefined;
  if (!command) {
    console.log(HELP);
    process.exit(name ? 1 : 0);
  }
  const database = createDatabase(loadConfig());
  try {
    await withDbRetry(() => runMigrations(database));
    await command(database);
  } finally {
    await database.close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
