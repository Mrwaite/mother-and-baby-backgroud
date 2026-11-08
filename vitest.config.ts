import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // 所有测试文件共用一个测试库，串行执行
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 120_000,
  },
});
