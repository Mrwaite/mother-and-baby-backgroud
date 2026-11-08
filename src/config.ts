import { z } from 'zod';

// 环境变量：生产环境在云托管「服务设置 → 环境变量」中配置
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    throw new Error(`环境变量校验失败：${result.error.message}`);
  }
  return result.data;
}
