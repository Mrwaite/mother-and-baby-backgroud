import { z } from 'zod';

// 环境变量：生产环境在云托管「服务设置 → 环境变量」中配置；本地开发用 .env（参考 .env.example）
const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    /** MySQL 内网地址 host:port */
    MYSQL_ADDRESS: z.string().regex(/^[^:]+:\d+$/, '格式应为 host:port'),
    MYSQL_USERNAME: z.string().min(1),
    MYSQL_PASSWORD: z.string().default(''),
    MYSQL_DATABASE: z.string().min(1).default('mother_baby'),
    /** 对象存储桶名称（「对象存储 → 存储配置」页面） */
    COS_BUCKET: z.string().optional(),
    COS_REGION: z.string().default('ap-shanghai'),
    /** 云托管自动注入的环境 ID */
    CBR_ENV_ID: z.string().optional(),
    /** 每日备份开关，默认生产环境开启 */
    BACKUP_ENABLED: z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => (v === undefined ? undefined : v === 'true')),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    for (const key of ['COS_BUCKET', 'CBR_ENV_ID'] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: '生产环境必须配置' });
    }
  })
  .transform((env) => {
    const [host, port] = env.MYSQL_ADDRESS.split(':');
    return {
      ...env,
      mysql: {
        host,
        port: Number(port),
        user: env.MYSQL_USERNAME,
        password: env.MYSQL_PASSWORD,
        database: env.MYSQL_DATABASE,
      },
      cos: env.COS_BUCKET && env.CBR_ENV_ID ? { bucket: env.COS_BUCKET, region: env.COS_REGION, envId: env.CBR_ENV_ID } : null,
      backupEnabled: env.BACKUP_ENABLED ?? env.NODE_ENV === 'production',
    };
  });

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`环境变量校验失败：\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
