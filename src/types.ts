import type { Config } from './config';
import type { Database, Db } from './db/client';
import type { Storage } from './lib/cos';

export interface AuthUser {
  id: number;
  displayName: string;
  openid: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    database: Database;
    db: Db;
    /** 未配置对象存储（本地开发）时为 null */
    storage: Storage | null;
  }
  interface FastifyRequest {
    /** 由 wx-identity 插件写入，业务路由中一定存在 */
    user: AuthUser;
  }
}
