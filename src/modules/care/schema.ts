import { z } from 'zod';
import {
  CARE_TYPES,
  DIAPER_KINDS,
  MEDICINE_UNITS,
  MILK_TYPES,
  POO_COLORS,
  POO_TEXTURES,
  SIDES,
  TEMP_SITES,
  type CarePayloadMap,
  type CareType,
} from '../../shared/care';
import { dateKey, optionalText, timestamp } from '../../lib/validation';

const note = optionalText(500);

const empty = z.object({});

/** 各类型 payload 的校验（未知字段会被去掉） */
export const payloadSchemas: { [K in CareType]: z.ZodType<CarePayloadMap[K]> } = {
  breastfeed: z.object({
    segments: z.array(z.object({ side: z.enum(SIDES), startAt: timestamp, endAt: timestamp.nullable() })).max(100),
  }),
  bottle: z.object({ milkType: z.enum(MILK_TYPES), amountMl: z.number().int().min(1).max(1000) }),
  diaper: z
    .object({ kind: z.enum(DIAPER_KINDS), pooColor: z.enum(POO_COLORS).optional(), pooTexture: z.enum(POO_TEXTURES).optional() })
    .transform((p) => (p.kind === 'pee' ? { kind: p.kind } : p)),
  sleep: empty as unknown as z.ZodType<CarePayloadMap['sleep']>,
  pump: z
    .object({
      totalMl: z.number().int().min(0).max(2000),
      leftMl: z.number().int().min(0).max(1000).optional(),
      rightMl: z.number().int().min(0).max(1000).optional(),
      durationMin: z.number().int().min(0).max(300).optional(),
    })
    // 填了左右量时，总量自动求和
    .transform((p) => (p.leftMl !== undefined || p.rightMl !== undefined ? { ...p, totalMl: (p.leftMl ?? 0) + (p.rightMl ?? 0) } : p)),
  temperature: z.object({
    celsius: z
      .number()
      .min(34)
      .max(43)
      .transform((v) => Math.round(v * 10) / 10),
    site: z.enum(TEMP_SITES).optional(),
  }),
  medicine: z.object({
    name: z.string().trim().min(1).max(32),
    dose: z.number().positive().max(10000),
    unit: z.enum(MEDICINE_UNITS),
  }),
  bath: empty as unknown as z.ZodType<CarePayloadMap['bath']>,
};

export const createBody = z.object({
  clientId: z.uuid(),
  type: z.enum(CARE_TYPES),
  startAt: timestamp,
  endAt: timestamp.nullable().optional(),
  // 按 type 在 service 中校验
  payload: z.unknown(),
  note,
});

export const updateBody = z.object({
  startAt: timestamp.optional(),
  endAt: timestamp.nullable().optional(),
  payload: z.unknown().optional(),
  note,
});

export const listQuery = z.object({
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(0),
  type: z.enum(CARE_TYPES).optional(),
});

export const summaryQuery = z.object({ date: dateKey });

export const lastQuery = z.object({ type: z.enum(CARE_TYPES) });
