import { Router } from 'express';
import { getTemplateMeta } from './templates.js';
import { hashPassword, verifyPassword, signToken, requireAuth } from './auth.js';

function publicUser(user) {
  return { id: user.id, username: user.username, createdAt: user.createdAt };
}

export function createRouter(botManager, storage) {
  const router = Router();

  const wrap = (fn) => (req, res, next) =>
    Promise.resolve(fn(req, res, next)).catch(next);

  /* ----------------------------- auth ----------------------------- */

  router.post('/auth/register', wrap(async (req, res) => {
    const { username, password } = req.body ?? {};
    if (typeof username !== 'string' || username.trim().length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    }
    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }
    if (storage.getUserByUsername(username.trim())) {
      return res.status(409).json({ error: 'That username is already taken.', code: 'username_taken' });
    }
    const user = storage.createUser({
      username: username.trim(),
      passwordHash: hashPassword(password),
    });
    const token = signToken({ sub: user.id, username: user.username });
    res.status(201).json({ token, user: publicUser(user) });
  }));

  router.post('/auth/login', wrap(async (req, res) => {
    const { username, password } = req.body ?? {};
    const user = storage.getUserByUsername(String(username ?? '').trim());
    if (!user || !verifyPassword(String(password ?? ''), user.passwordHash)) {
      return res.status(401).json({ error: 'Invalid username or password.', code: 'invalid_credentials' });
    }
    const token = signToken({ sub: user.id, username: user.username });
    res.json({ token, user: publicUser(user) });
  }));

  router.get('/auth/me', requireAuth, (req, res) => {
    const user = storage.getUserById(req.user.id);
    if (!user) return res.status(401).json({ error: 'Not authenticated.', code: 'unauthorized' });
    res.json({ user: publicUser(user) });
  });

  // Deleting an account also stops and removes all of its bots.
  router.delete('/auth/account', requireAuth, wrap(async (req, res) => {
    await botManager.removeBotsForOwner(req.user.id);
    storage.deleteUser(req.user.id);
    res.json({ ok: true });
  }));

  /* --------------------------- templates -------------------------- */

  router.get('/templates', (_req, res) => {
    res.json(getTemplateMeta());
  });

  /* ----------------------------- bots ----------------------------- */

  router.post('/bots/validate', requireAuth, wrap(async (req, res) => {
    const token = req.body?.token;
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'A token is required.' });
    }
    const bot = await botManager.validateToken(token.trim());
    res.json({ valid: true, bot });
  }));

  router.post('/bots/deploy', requireAuth, wrap(async (req, res) => {
    const { token, templateId } = req.body ?? {};
    if (typeof token !== 'string' || !token.trim()) {
      return res.status(400).json({ error: 'A token is required.' });
    }
    if (typeof templateId !== 'string' || !templateId) {
      return res.status(400).json({ error: 'A template is required.' });
    }
    const bot = await botManager.deployBot({
      token: token.trim(),
      templateId,
      ownerId: req.user.id,
    });
    res.status(201).json(bot);
  }));

  router.get('/bots', requireAuth, (req, res) => {
    res.json(botManager.list(req.user.id));
  });

  router.get('/bots/:id', requireAuth, (req, res) => {
    if (!botManager.isOwner(req.params.id, req.user.id)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    res.json(botManager.serialize(req.params.id));
  });

  router.post('/bots/:id/stop', requireAuth, wrap(async (req, res) => {
    if (!botManager.isOwner(req.params.id, req.user.id)) {
      return res.status(404).json({ error: 'Bot not found.' });
    }
    await botManager.stopBot(req.params.id);
    res.json(botManager.serialize(req.params.id));
  }));

  router.post('/bots/:id/restart', requireAuth, wrap(async (req, res) => {
    const bot = await botManager.restartBot(req.params.id, req.user.id);
    res.json(bot);
  }));

  router.post('/bots/:id/template', requireAuth, wrap(async (req, res) => {
    const { templateId } = req.body ?? {};
    if (typeof templateId !== 'string' || !templateId) {
      return res.status(400).json({ error: 'A template is required.' });
    }
    const bot = await botManager.changeTemplate(req.params.id, templateId, req.user.id);
    res.json(bot);
  }));

  router.delete('/bots/:id', requireAuth, wrap(async (req, res) => {
    await botManager.removeBot(req.params.id, req.user.id);
    res.json({ ok: true });
  }));

  return router;
}
