import { z } from 'zod';

// 各模块共用的 zod 片段

export const timestamp = z.number().int().min(0);

/** 北京时间日期 YYYY-MM-DD */
export const dateKey = z.iso.date();

/** 可选文本：去掉首尾空格，空字符串视为 null */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === '' ? null : v));

export const idParams = z.object({ id: z.coerce.number().int().positive() });
