import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { idParams } from '../../lib/validation';
import { createBody, lastQuery, listQuery, summaryQuery, updateBody } from './schema';
import * as care from './service';

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/care-records', { schema: { querystring: listQuery } }, (req) => care.listRecords(app.db, req.query));

  app.get('/care-records/summary', { schema: { querystring: summaryQuery } }, async (req) =>
    care.computeSummary(req.query.date, await care.dayRecords(app.db, req.query.date)),
  );

  // 包一层对象：直接返回 null 时响应体为空，前端不好区分
  app.get('/care-records/last', { schema: { querystring: lastQuery } }, async (req) => ({
    record: await care.lastRecord(app.db, [req.query.type]),
  }));

  app.get('/care-records/medicine-names', () => care.medicineNames(app.db));

  app.post('/care-records', { schema: { body: createBody } }, async (req, reply) => {
    const { record, created } = await care.createRecord(app.db, req.user, req.body);
    return reply.status(created ? 201 : 200).send(record);
  });

  app.put('/care-records/:id', { schema: { params: idParams, body: updateBody } }, (req) =>
    care.updateRecord(app.db, req.user, req.params.id, req.body),
  );

  app.delete('/care-records/:id', { schema: { params: idParams } }, async (req, reply) => {
    await care.deleteRecord(app.db, req.user, req.params.id);
    return reply.status(204).send();
  });
};

export default routes;
