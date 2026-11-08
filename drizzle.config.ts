import { defineConfig } from 'drizzle-kit';

// 只用于 drizzle-kit generate / studio；服务启动时由 src/db/migrate.ts 执行迁移
export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: {
    host: process.env.MYSQL_ADDRESS?.split(':')[0] ?? '127.0.0.1',
    port: Number(process.env.MYSQL_ADDRESS?.split(':')[1] ?? 3306),
    user: process.env.MYSQL_USERNAME ?? 'root',
    password: process.env.MYSQL_PASSWORD ?? '',
    database: process.env.MYSQL_DATABASE ?? 'mother_baby',
  },
});
