import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TOKEN_CHECK_DEFAULT_MS = 15 * 60 * 1000; // 15 minutes

export const config = {
  port: Number(process.env.PORT) || 4000,
  dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
  encryptionKey: process.env.ENCRYPTION_KEY || '',
  jwtSecret: process.env.JWT_SECRET || '',
  // Comma-separated origins, or "*" to allow all.
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  // How often to re-check running bots for revoked tokens (ms).
  tokenCheckIntervalMs: Number(process.env.TOKEN_CHECK_INTERVAL_MS) || TOKEN_CHECK_DEFAULT_MS,
  isProduction: process.env.NODE_ENV === 'production',
};
