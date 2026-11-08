import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts', 'src/cli.ts'],
  format: ['esm'],
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // 迁移 SQL 由服务启动时读取，和入口文件放在同一目录
  onSuccess: 'mkdir -p dist/migrations && cp -R src/db/migrations/. dist/migrations/',
});
