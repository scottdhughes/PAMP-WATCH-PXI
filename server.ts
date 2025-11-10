import Fastify from 'fastify';
import cors from '@fastify/cors';
import { buildLatestResponse } from './services/buildLatestResponse.js';
import { logger } from './logger.js';
import { config } from './config.js';
import { pool } from './db.js';

const server = Fastify({ logger });

const registerPlugins = async (): Promise<void> => {
  await server.register(cors, { origin: true });
};

server.get('/healthz', async () => ({ ok: true }));

server.get('/pxi/latest', async (request, reply) => {
  const data = await buildLatestResponse();
  if (!data) {
    return reply.code(503).send({ message: 'PXI composite not ready' });
  }
  return data;
});

const start = async (): Promise<void> => {
  try {
    await registerPlugins();
    await server.listen({ port: config.port, host: config.host });
    logger.info({ port: config.port }, 'API server running');
  } catch (error) {
    logger.error({ error }, 'Failed to start API server');
    process.exit(1);
  }
};

start();

const shutdown = async (): Promise<void> => {
  logger.info('Shutting down API server');
  await server.close();
  await pool.end();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
