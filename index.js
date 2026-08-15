import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { initCrypto, getEncryptionKey } from './crypto.js';
import { initAuth } from './auth.js';
import { Storage } from './storage.js';
import { BotManager } from './botManager.js';
import { createRouter } from './routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

fs.mkdirSync(config.dataDir, { recursive: true });
initCrypto(config.dataDir);

// Reuse the persisted encryption key as the JWT signing secret unless one
// is explicitly provided, so tokens stay valid across restarts.
initAuth(config.jwtSecret || getEncryptionKey().toString('hex'));

const storage = new Storage(config.dataDir);
const botManager = new BotManager(storage);

const app = express();
app.disable('x-powered-by');
app.use(
  cors({
    origin: config.clientOrigins.includes('*') ? '*' : config.clientOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use('/api', createRouter(botManager, storage));
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Serve the built client when present (single-server production deploys).
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist, { maxAge: '1d' }));
  app.get('*', (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
}

// Centralized error handler.
app.use((err, _req, res, _next) => {
  const status = err?.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err?.message || 'Internal server error.', code: err?.code });
});

app.listen(config.port, async () => {
  console.log(`\n🤖 BotForge API → http://localhost:${config.port}`);
  console.log('Reconnecting any previously active bots…\n');
  await botManager.reconnectAll();

  // Periodically drop bots whose tokens were revoked in the Discord portal.
  setInterval(() => {
    botManager.cleanupRevoked().catch((err) => console.error('cleanup failed:', err.message));
  }, config.tokenCheckIntervalMs).unref();
});
