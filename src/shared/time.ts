// 自动生成，勿改：由 scripts/sync-shared.sh 从 mother-and-baby-mini-program/miniprogram/shared/ 同步
// 前后端共享：业务时间统一为 UTC 毫秒时间戳，「天」按 Asia/Shanghai（固定 UTC+8，无夏令时）切分
// 不依赖运行环境的时区设置（云托管容器默认 UTC）

export const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** 时间戳所在自然日 00:00（北京时间）的时间戳 */
export function dayStartOf(ts: number): number {
  return Math.floor((ts + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 时间戳对应的北京时间日期 `YYYY-MM-DD` */
export function dateKeyOf(ts: number): string {
  const d = new Date(ts + TZ_OFFSET_MS);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateKey(s: string): boolean {
  const m = DATE_KEY_RE.exec(s);
  if (!m) return false;
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dateKeyOf(ts - TZ_OFFSET_MS) === s;
}

/** `YYYY-MM-DD`（北京时间）当天 00:00 的时间戳 */
export function dayStartFromKey(key: string): number {
  const m = DATE_KEY_RE.exec(key);
  if (!m) throw new Error(`invalid date key: ${key}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - TZ_OFFSET_MS;
}

/** 日期加减天数 */
export function addDays(key: string, days: number): string {
  return dateKeyOf(dayStartFromKey(key) + days * DAY_MS);
}

/** 两个日期之间相差的天数（b - a） */
export function diffDays(a: string, b: string): number {
  return Math.round((dayStartFromKey(b) - dayStartFromKey(a)) / DAY_MS);
}

/**
 * 按出生日期计算某天的月龄：满几个月零几天（按日历月计算）。
 * 例如 2026-01-31 出生，2026-02-28 为 0 个月 28 天，2026-03-01 为 1 个月 1 天。
 */
export function ageOf(birthDate: string, onDate: string): { months: number; days: number; totalDays: number } {
  const totalDays = diffDays(birthDate, onDate);
  if (totalDays < 0) return { months: 0, days: 0, totalDays };
  const [by, bm, bd] = birthDate.split('-').map(Number);
  const [ty, tm, td] = onDate.split('-').map(Number);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  // 满 months 个月的那一天（月底溢出时取当月最后一天）
  const anchorY = by + Math.floor((bm - 1 + months) / 12);
  const anchorM = ((bm - 1 + months) % 12) + 1;
  const lastDay = new Date(Date.UTC(anchorY, anchorM, 0)).getUTCDate();
  const anchor = `${anchorY}-${pad2(anchorM)}-${pad2(Math.min(bd, lastDay))}`;
  return { months, days: diffDays(anchor, onDate), totalDays };
}

/** 生长曲线横轴使用的精确月龄（天数 / 30.4375） */
export function ageInMonths(birthDate: string, onDate: string): number {
  return diffDays(birthDate, onDate) / 30.4375;
}
