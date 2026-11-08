import COS from 'cos-nodejs-sdk-v5';

/** 服务端用到的对象存储操作（测试中可替换为内存实现） */
export interface Storage {
  /** cloud:// 文件 ID 的前缀：cloud://<环境 ID>.<存储桶>/ */
  readonly fileIdPrefix: string;
  /** 文件不存在时返回 null */
  headObject(key: string): Promise<{ size: number; mime: string } | null>;
  getObject(key: string): Promise<Buffer>;
  putObject(key: string, body: Buffer, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
}

interface CosAuthResponse {
  TmpSecretId: string;
  TmpSecretKey: string;
  Token: string;
  ExpiredTime: number;
}

// 开启「开放接口服务」后，容器内可以用 HTTP 免鉴权获取对象存储临时密钥
const GET_AUTH_URL = 'http://api.weixin.qq.com/_/cos/getauth';

export function createCosStorage(opts: { bucket: string; region: string; envId: string }): Storage {
  const cos = new COS({
    getAuthorization(_options, callback) {
      fetch(GET_AUTH_URL)
        .then(async (res) => {
          if (!res.ok) throw new Error(`getauth HTTP ${res.status}`);
          const data = (await res.json()) as CosAuthResponse;
          callback({
            TmpSecretId: data.TmpSecretId,
            TmpSecretKey: data.TmpSecretKey,
            SecurityToken: data.Token,
            StartTime: Math.floor(Date.now() / 1000),
            ExpiredTime: data.ExpiredTime,
          });
        })
        .catch((err: unknown) => {
          // SDK 没有错误回调，交给本次请求超时失败；记录日志便于排查
          console.error(JSON.stringify({ level: 50, msg: 'cos getauth failed', err: String(err) }));
        });
    },
  });
  const base = { Bucket: opts.bucket, Region: opts.region };

  return {
    fileIdPrefix: `cloud://${opts.envId}.${opts.bucket}/`,
    async headObject(key) {
      try {
        const res = await cos.headObject({ ...base, Key: key });
        const headers = (res.headers ?? {}) as Record<string, string | undefined>;
        return { size: Number(headers['content-length'] ?? 0), mime: headers['content-type'] ?? '' };
      } catch (err) {
        if ((err as { statusCode?: number }).statusCode === 404) return null;
        throw err;
      }
    },
    async getObject(key) {
      const res = await cos.getObject({ ...base, Key: key });
      return res.Body as Buffer;
    },
    async putObject(key, body, contentType) {
      // 不写入文件元数据：按云托管规则小程序端无法访问这些文件（用于备份）
      await cos.putObject({ ...base, Key: key, Body: body, ContentType: contentType });
    },
    async deleteObject(key) {
      await cos.deleteObject({ ...base, Key: key });
    },
  };
}

/** 内存实现：本地开发和测试用 */
export function createMemoryStorage(fileIdPrefix = 'cloud://dev-env.dev-bucket/'): Storage & {
  objects: Map<string, { body: Buffer; mime: string }>;
} {
  const objects = new Map<string, { body: Buffer; mime: string }>();
  return {
    objects,
    fileIdPrefix,
    async headObject(key) {
      const o = objects.get(key);
      return o ? { size: o.body.length, mime: o.mime } : null;
    },
    async getObject(key) {
      const o = objects.get(key);
      if (!o) throw new Error(`object not found: ${key}`);
      return o.body;
    },
    async putObject(key, body, mime) {
      objects.set(key, { body, mime });
    },
    async deleteObject(key) {
      objects.delete(key);
    },
  };
}
