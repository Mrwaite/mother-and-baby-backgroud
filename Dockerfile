FROM node:24-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci --registry=https://registry.npmmirror.com
COPY . .
RUN npm run build

FROM node:24-slim
ENV NODE_ENV=production PORT=80 TZ=Asia/Shanghai
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --registry=https://registry.npmmirror.com
COPY --from=build /app/dist ./dist
EXPOSE 80
CMD ["node", "dist/main.js"]
