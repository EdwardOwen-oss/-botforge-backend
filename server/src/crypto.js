import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

let key = null;

/**
 * Initialize the encryption key used to protect bot tokens at rest.
 * Prefers an explicit ENCRYPTION_KEY env var; otherwise generates (or reuses)
 * a random key persisted inside the data directory so tokens survive restarts.
 */
export function initCrypto(dataDir) {
  const keyPath = path.join(dataDir, 'secret.key');
  if (process.env.ENCRYPTION_KEY) {
    key = crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY).digest();
  } else if (fs.existsSync(keyPath)) {
    key = Buffer.from(fs.readFileSync(keyPath, 'utf8').trim(), 'hex');
  } else {
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key.toString('hex'), { mode: 0o600 });
  }
  return key;
}

export function encryptToken(plain) {
  if (!key) throw new Error('Crypto not initialized');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: enc.toString('hex'),
  });
}

export function decryptToken(payload) {
  if (!key) throw new Error('Crypto not initialized');
  try {
    const { iv, tag, data } = JSON.parse(payload);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    const dec = Buffer.concat([decipher.update(Buffer.from(data, 'hex')), decipher.final()]);
    return dec.toString('utf8');
  } catch {
    return null;
  }
}

/** Expose the master key so it can also seed the JWT signing secret. */
export function getEncryptionKey() {
  if (!key) throw new Error('Crypto not initialized');
  return key;
}
