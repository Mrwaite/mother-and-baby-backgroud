import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { DashboardResponse } from '../../shared/api';
import { dateKeyOf } from '../../shared/time';
import * as care from '../care/service';
import { lowStockItems } from '../inventory/service';

// 首页聚合数据，一次请求拿全，减少首页的请求数
const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/dashboard', async (): Promise<DashboardResponse> => {
    const now = Date.now();
    const today = dateKeyOf(now);
    const [dayRecords, lastFeed, lastDiaper, running, lowStock] = await Promise.all([
      care.dayRecords(app.db, today),
      care.lastRecord(app.db, ['breastfeed', 'bottle']),
      care.lastRecord(app.db, ['diaper']),
      care.runningRecords(app.db),
      lowStockItems(app.db),
    ]);
    return {
      serverTime: now,
      lastFeed,
      lastDiaper,
      running,
      today: care.computeSummary(today, dayRecords, now),
      recent: dayRecords.inDay.slice(0, 5),
      lowStockCount: lowStock.length,
      lowStockItems: lowStock.slice(0, 3),
    };
  });
};

export default routes;
