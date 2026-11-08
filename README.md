# mother-and-baby-backgroud

母婴家庭记录小程序的服务端，部署在微信云托管。设计见小程序仓库同级目录下的 `docs/一期需求/后端技术方案.md`。

技术栈：Node.js 22+ / TypeScript / Fastify 5 / zod 4 / Drizzle ORM + MySQL 8.0 / 云托管对象存储（COS）。

- 身份：服务关闭公网访问，只接受小程序 `wx.cloud.callContainer` 调用；openid 取自网关注入的 `X-WX-OPENID`，再按 `users` 表白名单放行（不在白名单返回 403，带上 openid 方便加白名单）。
- 时间：全部为 UTC 毫秒时间戳，「天」按北京时间（UTC+8）切分。
- 数据库：启动时自动执行迁移（`GET_LOCK` 防止多实例并发）；MySQL Serverless 唤醒中会自动退避重试，仍失败返回 `503 DB_UNAVAILABLE`，前端提示「正在唤醒」后重试。
- 备份：每天北京时间 3 点后把全库导出为 `backups/db/YYYY-MM-DD.json.gz` 上传到对象存储，保留 30 天。

## 本地开发

需要 Node.js 24（见 `.nvmrc`，最低 22）和一个 MySQL 8.0。

```bash
npm install
docker compose -f docker-compose.dev.yml up -d   # 本地 MySQL，root / dev，自动建 mother_baby 和 mother_baby_test
cp .env.example .env
npm run cli -- user:add --openid dev-openid --name 妈妈   # 加入白名单（会先执行迁移）
npm run dev                                         # http://localhost:3000，代码变动自动重启
curl localhost:3000/healthz
curl -H 'X-WX-OPENID: dev-openid' localhost:3000/api/v1/me
```

更多请求示例见 `api.http`。本地不配置 `COS_BUCKET` 时，照片登记只校验文件 ID 格式，也不会执行每日备份。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 本地开发，代码变动自动重启 |
| `npm run typecheck` | 类型检查 |
| `npm test` | 接口测试（vitest + 真实 MySQL，见下文） |
| `npm run build` | tsup 打包到 `dist/`（含迁移文件） |
| `npm start` | 运行打包产物 |
| `npm run cli -- <命令>` | 管理命令，见下文 |
| `npm run db:generate` | 修改 `src/db/schema.ts` 后生成迁移 SQL |
| `npm run sync-shared` | 从小程序仓库同步 `miniprogram/shared/` 到 `src/shared/`（以小程序仓库为准，勿直接改 `src/shared/`） |
| `npm run check-shared` | 检查 `src/shared/` 是否与小程序仓库一致 |
| `npm run predeploy` | 部署前检查：check-shared + typecheck + test |

## 测试

```bash
npm test
```

- 默认用 `mysql-memory-server` 临时下载并启动一个 MySQL 8.0（首次较慢，二进制缓存在 `TMPDIR` 下）。
- 也可以连已有的库：设置 `MYSQL_TEST_ADDRESS`（及 `MYSQL_TEST_USERNAME` / `MYSQL_TEST_PASSWORD` / `MYSQL_TEST_DATABASE`，默认库名 `mother_baby_test`），例如用 docker-compose 起的 MySQL。
- macOS 上如果项目路径很长（例如包含中文目录），MySQL 的 socket 路径可能超过 103 字节导致启动失败。可以把 `TMPDIR` 指向一个短路径：
  ```bash
  mkdir -p .tmp && ln -sfn "$PWD/.tmp" /tmp/mbt && TMPDIR=/tmp/mbt npm test
  ```

## 管理命令

本地：`npm run cli -- <命令>`；线上：云托管「实例 → WebShell」中执行 `node dist/cli.js <命令>`。

| 命令 | 说明 |
|---|---|
| `user:add --openid <openid> --name <名称>` | 添加家庭成员（已存在则更新名称并启用） |
| `user:list` | 列出成员 |
| `user:rename --openid <openid> --name <名称>` | 修改显示名称 |
| `user:disable --openid <openid>` / `user:enable --openid <openid>` | 禁用 / 重新启用 |
| `migrate` | 执行迁移 |
| `backup:run [--out <本地文件>]` | 立即备份（默认上传到对象存储） |
| `backup:restore --file <对象存储 key>` / `--local <本地文件>` | 从备份恢复到空库（要求迁移版本一致） |

家人第一次打开小程序会看到「暂无访问权限」页和自己的 openid，复制给管理员执行 `user:add` 即可。

## 接口

前缀 `/api/v1`，除 `/healthz` 外都需要白名单身份。请求 / 响应结构见 `src/shared/api.ts`。

| 模块 | 接口 |
|---|---|
| 我的 | `GET /me`、`PUT /baby` |
| 首页 | `GET /dashboard` |
| 护理记录 | `GET /care-records?from&to&type`、`GET /care-records/summary?date`、`GET /care-records/last?type`、`GET /care-records/medicine-names`、`POST /care-records`（`clientId` 幂等；同类计时进行中返回 409 `TIMER_RUNNING`）、`PUT /care-records/:id`、`DELETE /care-records/:id` |
| 生长测量 | `GET /growth-records`、`POST`、`PUT /:id`、`DELETE /:id` |
| 里程碑 | `GET /milestones`、`GET /:id`、`POST`、`PUT /:id`、`DELETE /:id`；照片先 `POST /files { fileId }` 登记 |
| 库存 | `GET /inventory/items?archived`、`GET /:id`、`POST`、`PUT /:id`、`GET /:id/logs?before&limit`、`POST /:id/logs`（出库超过库存返回 409 `INSUFFICIENT_STOCK`） |

错误统一为 `{ "error": { "code", "message" } }`，错误码见 `src/shared/api.ts` 的 `ERROR_CODES`。

## 部署

云托管按根目录的 `Dockerfile` 构建镜像，服务监听 80 端口。环境变量在云托管「服务设置 → 环境变量」中配置：

| 变量 | 说明 |
|---|---|
| `MYSQL_ADDRESS` / `MYSQL_USERNAME` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | MySQL 内网地址（`host:port`）和账号。库需建为 `utf8mb4` / `utf8mb4_0900_ai_ci` |
| `COS_BUCKET` / `COS_REGION` | 对象存储桶（生产必填），见「对象存储 → 存储配置」 |
| `CBR_ENV_ID` | 云托管环境 ID（自动注入） |
| `BACKUP_ENABLED` | 每日备份开关，生产默认开启 |

部署前在本地执行 `npm run predeploy`。首次部署后在 WebShell 中用 `user:add` 添加家庭成员。
