import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Minimal JSON file-backed store for users and deployed bots.
 * Bot tokens are stored encrypted (see crypto.js) — never in plaintext.
 * Passwords are stored as scrypt hashes (see auth.js).
 */
export class Storage {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'db.json');
    this.data = { users: [], bots: [] };
    this._load();
  }

  _load() {
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        this.data = {
          users: Array.isArray(parsed.users) ? parsed.users : [],
          // Drop legacy bots that predate per-user ownership.
          bots: (Array.isArray(parsed.bots) ? parsed.bots : []).filter((b) => b.ownerId),
        };
      } catch {
        this.data = { users: [], bots: [] };
      }
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  /* ---------------------------- users ---------------------------- */

  listUsers() {
    return this.data.users;
  }

  getUserById(id) {
    return this.data.users.find((u) => u.id === id) || null;
  }

  getUserByUsername(username) {
    return this.data.users.find((u) => u.username.toLowerCase() === String(username).toLowerCase()) || null;
  }

  createUser({ username, passwordHash }) {
    const user = {
      id: crypto.randomUUID(),
      username,
      passwordHash,
      createdAt: new Date().toISOString(),
    };
    this.data.users.push(user);
    this._save();
    return user;
  }

  deleteUser(id) {
    this.data.users = this.data.users.filter((u) => u.id !== id);
    this.data.bots = this.data.bots.filter((b) => b.ownerId !== id);
    this._save();
  }

  /* ----------------------------- bots ---------------------------- */

  allBots() {
    return this.data.bots;
  }

  listBots(ownerId) {
    return this.data.bots.filter((b) => b.ownerId === ownerId);
  }

  getBot(id) {
    return this.data.bots.find((b) => b.id === id) || null;
  }

  upsertBot(bot) {
    const idx = this.data.bots.findIndex((b) => b.id === bot.id);
    if (idx >= 0) {
      this.data.bots[idx] = { ...this.data.bots[idx], ...bot };
    } else {
      this.data.bots.push(bot);
    }
    this._save();
    return this.getBot(bot.id);
  }

  removeBot(id) {
    this.data.bots = this.data.bots.filter((b) => b.id !== id);
    this._save();
  }
}
