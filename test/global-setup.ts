import type { TestProject } from 'vitest/node';

export interface TestMysql {
  address: string;
  user: string;
  password: string;
  database: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    mysql: TestMysql;
  }
}

/**
 * 测试库：设置了 MYSQL_TEST_ADDRESS 时连已有的 MySQL（如 docker-compose.dev.yml 启动的 mother_baby_test 库），
 * 否则用 mysql-memory-server 临时启动一个 MySQL 8.0（首次会下载二进制，之后复用缓存）。
 */
export default async function setup(project: TestProject) {
  if (process.env.MYSQL_TEST_ADDRESS) {
    project.provide('mysql', {
      address: process.env.MYSQL_TEST_ADDRESS,
      user: process.env.MYSQL_TEST_USERNAME ?? 'root',
      password: process.env.MYSQL_TEST_PASSWORD ?? '',
      database: process.env.MYSQL_TEST_DATABASE ?? 'mother_baby_test',
    });
    return;
  }

  const { createDB } = await import('mysql-memory-server');
  const db = await createDB({ version: '8.0.x', dbName: 'mother_baby_test', logLevel: 'ERROR', downloadBinaryOnce: true });
  project.provide('mysql', { address: `127.0.0.1:${db.port}`, user: db.username, password: '', database: db.dbName });
  return () => db.stop();
}
