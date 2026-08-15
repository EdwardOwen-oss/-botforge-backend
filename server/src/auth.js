import crypto from 'node:crypto';

const JWT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

let jwtSecret;

export function initAuth(secret) {
  if (!secret) throw new Error('A JWT secret is required.');
  jwtSecret = secret;
}

/* ---------------------------------------------------------------- */
/* Password hashing (scrypt) — one-way, salted                        */
/* ---------------------------------------------------------------- */

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, hash] = String(stored).split(':');
    const candidate = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hash, 'hex');
    return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- */
/* JWT (HS256)                                                        */
/* ---------------------------------------------------------------- */

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

export function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + JWT_TTL_SECONDS }));
  const signature = crypto
    .createHmac('sha256', jwtSecret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyToken(token) {
  try {
    const [header, body, signature] = String(token).split('.');
    if (!header || !body || !signature) return null;
    const expected = crypto
      .createHmac('sha256', jwtSecret)
      .update(`${header}.${body}`)
      .digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------- */
/* Express middleware                                                 */
/* ---------------------------------------------------------------- */

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload || !payload.sub) {
    return res.status(401).json({ error: 'Not authenticated.', code: 'unauthorized' });
  }
  req.user = { id: payload.sub, username: payload.username };
  next();
}
