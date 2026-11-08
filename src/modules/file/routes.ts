import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isDuplicateKey } from '../../db/client';
import { files } from '../../db/schema';
import { AppError } from '../../lib/errors';
import { MAX_PHOTO_BYTES, MILESTONE_PHOTO_DIR, type Photo } from '../../shared/api';

const body = z.object({ fileId: z.string().startsWith('cloud://').max(512) });

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);
const IMAGE_EXT = /\.(jpe?g|png|heic|heif|webp)$/i;

const invalid = (message: string) => new AppError(400, 'INVALID_FILE', message);

/**
 * 登记已由小程序 wx.cloud.uploadFile 上传到对象存储的图片。
 * 生产环境校验文件 ID 属于本环境的存储桶、文件确实存在、大小和类型合法；
 * 本地开发未配置对象存储时只校验路径格式。
 */
const routes: FastifyPluginAsyncZod = async (app) => {
  app.post('/files', { schema: { body } }, async (req, reply) => {
    const { fileId } = req.body;
    const storage = app.storage;
    let size = 0;
    let mime = '';
    if (fileId.includes('..')) throw invalid('文件 ID 格式不正确');

    if (storage) {
      if (!fileId.startsWith(storage.fileIdPrefix + MILESTONE_PHOTO_DIR)) throw invalid('文件不属于本小程序的照片目录');
      const key = fileId.slice(storage.fileIdPrefix.length);
      if (!IMAGE_EXT.test(key)) throw invalid('只支持 jpg / png / heic 图片');
      const head = await storage.headObject(key);
      if (!head) throw invalid('文件不存在，请重新上传');
      if (head.size > MAX_PHOTO_BYTES) throw invalid('图片不能超过 10MB');
      if (head.mime && !IMAGE_MIME.has(head.mime) && head.mime !== 'application/octet-stream') {
        throw invalid('只支持 jpg / png / heic 图片');
      }
      size = head.size;
      mime = head.mime;
    } else if (!/^cloud:\/\/[^/]+\/milestones\/.+/.test(fileId) || !IMAGE_EXT.test(fileId)) {
      throw invalid('文件 ID 格式不正确');
    }

    const id = randomUUID();
    try {
      await app.db
        .insert(files)
        .values({ id, cloudFileId: fileId, size, mime, createdBy: req.user.id, createdAt: Date.now() });
      return reply.status(201).send({ id, fileId } satisfies Photo);
    } catch (err) {
      if (!isDuplicateKey(err, 'uk_cloud_file_id')) throw err;
      const [row] = await app.db.select().from(files).where(eq(files.cloudFileId, fileId)).limit(1);
      return { id: row!.id, fileId } satisfies Photo;
    }
  });
};

export default routes;
