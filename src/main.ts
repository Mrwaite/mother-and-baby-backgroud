import { buildApp } from './app';
import { loadConfig } from './config';

const config = loadConfig();
const app = buildApp(config);

// 云托管下线实例时会发送 SIGTERM，先处理完进行中的请求再退出
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

try {
  await app.listen({ host: '0.0.0.0', port: config.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
