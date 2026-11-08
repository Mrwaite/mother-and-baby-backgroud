import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { idParams, optionalText, timestamp } from '../../lib/validation';
import { INVENTORY_ACTIONS, INVENTORY_CATEGORIES } from '../../shared/inventory';
import * as inventory from './service';

const quantity = z.number().int().min(0).max(100000);

const itemFields = {
  name: z.string().trim().min(1).max(64),
  category: z.enum(INVENTORY_CATEGORIES),
  spec: optionalText(32),
  unit: z.string().trim().min(1).max(8),
  lowThreshold: quantity,
  note: optionalText(500),
};
const createItemBody = z.object({ ...itemFields, quantity: quantity.optional() });
const updateItemBody = z.object({ ...itemFields, archived: z.boolean() }).partial();

const listQuery = z.object({ archived: z.enum(['true', 'false']).default('false') });

const logsQuery = z.object({
  before: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const logBody = z
  .object({
    action: z.enum(INVENTORY_ACTIONS),
    quantity,
    priceCents: z.number().int().min(0).max(100_000_000).nullable().optional(),
    channel: optionalText(32),
    occurredAt: timestamp.optional(),
    note: optionalText(500),
  })
  .refine((b) => b.action === 'adjust' || b.quantity > 0, { message: '数量必须大于 0', path: ['quantity'] });

const routes: FastifyPluginAsyncZod = async (app) => {
  app.get('/inventory/items', { schema: { querystring: listQuery } }, (req) =>
    inventory.listItems(app.db, req.query.archived === 'true'),
  );

  app.get('/inventory/items/:id', { schema: { params: idParams } }, (req) => inventory.getItem(app.db, req.params.id));

  app.post('/inventory/items', { schema: { body: createItemBody } }, async (req, reply) =>
    reply.status(201).send(await inventory.createItem(app.db, req.user, req.body)),
  );

  app.put('/inventory/items/:id', { schema: { params: idParams, body: updateItemBody } }, (req) =>
    inventory.updateItem(app.db, req.params.id, req.body),
  );

  app.get('/inventory/items/:id/logs', { schema: { params: idParams, querystring: logsQuery } }, (req) =>
    inventory.listLogs(app.db, req.params.id, req.query.before, req.query.limit),
  );

  app.post('/inventory/items/:id/logs', { schema: { params: idParams, body: logBody } }, async (req, reply) =>
    reply.status(201).send(await inventory.addLog(app.db, req.user, req.params.id, req.body)),
  );
};

export default routes;
