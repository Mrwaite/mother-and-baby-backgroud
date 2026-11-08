# mother-and-baby-backgroud

母婴家庭记录小程序的服务端，部署在微信云托管。设计见小程序仓库同级目录下的 `docs/一期需求/后端技术方案.md`。

技术栈：Node.js + TypeScript + Fastify。

## 本地开发

需要 Node.js 24（见 `.nvmrc`，最低 22）。

```bash
npm install
npm run dev        # tsx watch，监听 http://localhost:3000
curl localhost:3000/healthz
```

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 本地开发，代码变动自动重启 |
| `npm run typecheck` | 类型检查 |
| `npm run build` | tsup 打包到 `dist/` |
| `npm start` | 运行打包产物 |

## 部署

云托管按根目录的 `Dockerfile` 构建镜像，服务监听 80 端口。环境变量在云托管「服务设置 → 环境变量」中配置，可配置项见 `.env.example`。
