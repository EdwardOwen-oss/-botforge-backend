/**
 * In-memory "tier database" for the Community Engagement template.
 * Tracks per-guild, per-member XP/level. Resets when the bot restarts,
 * which is acceptable for a lightweight demo leveling system.
 */
export class XpStore {
  constructor() {
    this.guilds = new Map(); // guildId -> Map(userId -> { level, xp })
  }

  ensure(guildId, userId) {
    let users = this.guilds.get(guildId);
    if (!users) {
      users = new Map();
      this.guilds.set(guildId, users);
    }
    let entry = users.get(userId);
    if (!entry) {
      entry = { level: 0, xp: 0 };
      users.set(userId, entry);
    }
    return entry;
  }

  top(guildId, n) {
    const users = this.guilds.get(guildId);
    if (!users) return [];
    return [...users.entries()]
      .map(([userId, e]) => ({ userId, level: e.level, xp: e.xp }))
      .sort((a, b) => b.level - a.level || b.xp - a.xp)
      .slice(0, n);
  }
}
