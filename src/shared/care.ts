// 自动生成，勿改：由 scripts/sync-shared.sh 从 mother-and-baby-mini-program/miniprogram/shared/ 同步
// 前后端共享：护理记录类型、payload 结构和预设选项

export const CARE_TYPES = ['breastfeed', 'bottle', 'diaper', 'sleep', 'pump', 'temperature', 'medicine', 'bath'] as const;
export type CareType = (typeof CARE_TYPES)[number];

/** 计时类记录（服务端保存计时状态，同一类型同时最多 1 个进行中） */
export const TIMER_TYPES = ['breastfeed', 'sleep'] as const;
export type TimerType = (typeof TIMER_TYPES)[number];

export function isTimerType(type: string): type is TimerType {
  return (TIMER_TYPES as readonly string[]).includes(type);
}

export const SIDES = ['left', 'right'] as const;
export type Side = (typeof SIDES)[number];

export const MILK_TYPES = ['breast', 'formula'] as const;
export type MilkType = (typeof MILK_TYPES)[number];

export const DIAPER_KINDS = ['pee', 'poo', 'both'] as const;
export type DiaperKind = (typeof DIAPER_KINDS)[number];

export const POO_COLORS = ['yellow', 'golden', 'green', 'brown', 'black', 'white', 'red'] as const;
export type PooColor = (typeof POO_COLORS)[number];

export const POO_TEXTURES = ['watery', 'mushy', 'soft', 'formed', 'hard', 'curd', 'mucus'] as const;
export type PooTexture = (typeof POO_TEXTURES)[number];

export const TEMP_SITES = ['armpit', 'ear', 'forehead', 'rectal'] as const;
export type TempSite = (typeof TEMP_SITES)[number];

export const MEDICINE_UNITS = ['ml', 'mg', 'drop', 'tablet', 'sachet'] as const;
export type MedicineUnit = (typeof MEDICINE_UNITS)[number];

export interface BreastSegment {
  side: Side;
  startAt: number;
  /** 为空表示这一侧正在喂 */
  endAt: number | null;
}

export interface CarePayloadMap {
  breastfeed: { segments: BreastSegment[] };
  bottle: { milkType: MilkType; amountMl: number };
  diaper: { kind: DiaperKind; pooColor?: PooColor; pooTexture?: PooTexture };
  sleep: Record<string, never>;
  pump: { totalMl: number; leftMl?: number; rightMl?: number; durationMin?: number };
  temperature: { celsius: number; site?: TempSite };
  medicine: { name: string; dose: number; unit: MedicineUnit };
  bath: Record<string, never>;
}

export type CarePayload<T extends CareType = CareType> = CarePayloadMap[T];

export const LABELS = {
  milkType: { breast: '母乳', formula: '配方奶' } as Record<MilkType, string>,
  diaperKind: { pee: '尿', poo: '便', both: '尿+便' } as Record<DiaperKind, string>,
  pooColor: {
    yellow: '黄色',
    golden: '金黄',
    green: '绿色',
    brown: '棕色',
    black: '黑色',
    white: '灰白',
    red: '带血',
  } as Record<PooColor, string>,
  pooTexture: {
    watery: '稀水样',
    mushy: '糊状',
    soft: '软便',
    formed: '成形',
    hard: '干硬',
    curd: '有奶瓣',
    mucus: '有黏液',
  } as Record<PooTexture, string>,
  tempSite: { armpit: '腋下', ear: '耳温', forehead: '额温', rectal: '肛温' } as Record<TempSite, string>,
  medicineUnit: { ml: 'ml', mg: 'mg', drop: '滴', tablet: '粒', sachet: '袋' } as Record<MedicineUnit, string>,
  side: { left: '左侧', right: '右侧' } as Record<Side, string>,
};

/** 体温高亮阈值（℃，≥ 即高亮）。未填测量部位时按腋下计算 */
export const FEVER_THRESHOLD: Record<TempSite, number> = {
  armpit: 37.3,
  forehead: 37.5,
  ear: 38.0,
  rectal: 38.0,
};

export function isFever(celsius: number, site?: TempSite): boolean {
  return celsius >= FEVER_THRESHOLD[site ?? 'armpit'];
}

/** 亲喂左右两侧的累计时长（毫秒）。进行中的一侧按 now 计算 */
export function breastSideDurations(segments: BreastSegment[], now: number): Record<Side, number> {
  const result: Record<Side, number> = { left: 0, right: 0 };
  for (const s of segments) {
    result[s.side] += Math.max(0, (s.endAt ?? now) - s.startAt);
  }
  return result;
}

/** 当前正在喂的一侧（进行中的亲喂） */
export function activeSide(segments: BreastSegment[]): Side | null {
  const last = segments[segments.length - 1];
  return last && last.endAt === null ? last.side : null;
}
