import { Client, Collection, Events, REST, Routes } from 'discord.js';
import { buildCommands, getTemplate, permissionsBitfield } from './templates.js';
import { XpStore } from './xpStore.js';
import { decryptToken, encryptToken } from './crypto.js';

export class BotError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function avatarUrl(user) {
  if (user.avatar) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=256`;
  }
  const idx = Number(user.discriminator || 0) % 5;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

function inviteUrl(clientId, templateId) {
  const perms = permissionsBitfield(templateId).toString();
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=${perms}&scope=bot%20applications.commands`;
}

function buildHelpGroups(commands) {
  const groups = [];
  const names = commands.map((c) => c.data.name);
  groups.push({
    title: 'General',
    commands: commands.filter((c) => ['ping', 'help', 'info'].includes(c.data.name)),
  });
  const rest = commands.filter((c) => !['ping', 'help', 'info'].includes(c.data.name));
  if (rest.length) groups.push({ title: 'Commands', commands: rest });
  return groups;
}

/**
 * Owns every live bot process. Each deployed bot gets its own
 * discord.js Client instance, keyed by the bot's application id.
 */
export class BotManager {
  constructor(storage) {
    this.storage = storage;
    this.instances = new Map(); // id -> { client, store }
  }

  /** Validate a token without opening a gateway connection. */
  async validateToken(token) {
    const rest = new REST({ version: '10' }).setToken(token);
    try {
      const user = await rest.get(Routes.user('@me'));
      return {
        id: user.id,
        username: user.username,
        tag: user.tag,
        avatar: avatarUrl(user),
      };
    } catch (err) {
      const status = err?.status ?? err?.code;
      const invalid = status === 401 || status === 403 || err?.code === 'TOKEN_INVALID';
      if (invalid) {
        throw new BotError('invalid_token', 'That token is invalid or has been revoked.');
      }
      throw new BotError('validation_failed', `Could not validate the token (${err?.message ?? 'unknown error'}).`);
    }
  }

  async deployBot({ token, templateId, ownerId }) {
    const template = getTemplate(templateId);
    if (!template) throw new BotError('unknown_template', 'That template does not exist.');

    const user = await this.validateToken(token);

    const existing = this.storage.getBot(user.id);
    if (existing && existing.ownerId !== ownerId) {
      throw new BotError('bot_owned', 'That bot token is already managed by another account.', 409);
    }
    if (existing && this.instances.has(user.id)) {
      throw new BotError('already_running', `That bot (${existing.name}) is already running.`);
    }

    const record = this.storage.upsertBot({
      id: user.id,
      ownerId,
      name: user.username,
      tag: user.tag,
      avatar: user.avatar,
      templateId: template.id,
      tokenEncrypted: encryptToken(token),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await this.spawnBot(record, token);
    return this.serialize(record.id);
  }

  /** Whether the given bot record is owned by the given user. */
  isOwner(id, ownerId) {
    return this.storage.getBot(id)?.ownerId === ownerId;
  }

  async spawnBot(record, token) {
    const template = getTemplate(record.templateId) ?? getTemplate('utility');
    const store = { autoroles: new Map(), xp: new XpStore() };
    const client = new Client({ intents: template.intents });

    const commands = buildCommands(record.templateId);
    const commandMap = new Collection();
    for (const cmd of commands) commandMap.set(cmd.data.name, cmd);

    const ctx = { template, store, helpGroups: buildHelpGroups(commands) };

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      const cmd = commandMap.get(interaction.commandName);
      if (!cmd) return;
      try {
        await cmd.execute(interaction, ctx);
      } catch (err) {
        console.error(`[bot:${record.name}] /${interaction.commandName} failed:`, err);
        const respond = interaction.replied || interaction.deferred
          ? interaction.followUp.bind(interaction)
          : interaction.reply.bind(interaction);
        respond({ content: 'Something went wrong running that command.', ephemeral: true }).catch(() => {});
      }
    });

    template.setup(ctx);

    client.once(Events.ClientReady, async (readyClient) => {
      // Persist any refreshed profile data.
      this.storage.upsertBot({
        id: record.id,
        name: readyClient.user.username,
        tag: readyClient.user.tag,
        avatar: readyClient.user.displayAvatarURL({ size: 256 }),
      });
      try {
        await this.registerCommands(token, readyClient.user.id, commands);
        console.log(`✔ ${readyClient.user.username} online (${template.name})`);
      } catch (err) {
        console.warn(`[${readyClient.user.username}] slash command registration failed:`, err.message);
      }
    });

    client.on(Events.Error, (err) => console.error(`[bot:${record.name}] error:`, err.message));
    client.on(Events.ShardError, (err) => console.error(`[bot:${record.name}] shard error:`, err.message));

    this.instances.set(record.id, { client, store });

    try {
      await client.login(token);
    } catch (err) {
      this.instances.delete(record.id);
      throw new BotError('login_failed', `Could not log in: ${err?.message ?? 'unknown error'}.`);
    }
  }

  async registerCommands(token, clientId, commands) {
    const rest = new REST({ version: '10' }).setToken(token);
    const body = commands.map((c) => c.data.toJSON());
    await rest.put(Routes.applicationCommands(clientId), { body });
  }

  async stopBot(id) {
    const inst = this.instances.get(id);
    if (!inst) return false;
    try {
      inst.client.destroy();
    } catch {
      /* already torn down */
    }
    this.instances.delete(id);
    return true;
  }

  async restartBot(id, ownerId) {
    const record = this.storage.getBot(id);
    if (!record || record.ownerId !== ownerId) {
      throw new BotError('not_found', 'Bot not found.', 404);
    }
    await this.stopBot(id);
    const token = decryptToken(record.tokenEncrypted);
    if (!token) throw new BotError('decrypt_failed', 'Stored token could not be decrypted.');
    await this.spawnBot(record, token);
    return this.serialize(id);
  }

  async changeTemplate(id, templateId, ownerId) {
    const record = this.storage.getBot(id);
    if (!record || record.ownerId !== ownerId) {
      throw new BotError('not_found', 'Bot not found.', 404);
    }
    if (!getTemplate(templateId)) throw new BotError('unknown_template', 'That template does not exist.');

    await this.stopBot(id);
    this.storage.upsertBot({ id, templateId, updatedAt: new Date().toISOString() });

    const updated = this.storage.getBot(id);
    const token = decryptToken(updated.tokenEncrypted);
    if (!token) throw new BotError('decrypt_failed', 'Stored token could not be decrypted.');
    await this.spawnBot(updated, token);
    return this.serialize(id);
  }

  async removeBot(id, ownerId) {
    const record = this.storage.getBot(id);
    if (!record || (ownerId && record.ownerId !== ownerId)) {
      throw new BotError('not_found', 'Bot not found.', 404);
    }
    await this.stopBot(id);
    this.storage.removeBot(id);
  }

  /** Stop and delete every bot owned by a user (account deletion). */
  async removeBotsForOwner(ownerId) {
    for (const record of this.storage.listBots(ownerId)) {
      await this.stopBot(record.id);
      this.storage.removeBot(record.id);
    }
  }

  /**
   * Periodic maintenance: shut down any running bot whose token has
   * been revoked in the Discord Developer Portal.
   */
  async cleanupRevoked() {
    for (const record of this.storage.allBots()) {
      if (!this.instances.has(record.id)) continue;
      const token = decryptToken(record.tokenEncrypted);
      if (!token) {
        await this.removeBot(record.id);
        continue;
      }
      try {
        await this.validateToken(token);
      } catch (err) {
        if (err?.code === 'invalid_token') {
          console.warn(`[${record.name}] token revoked — shutting down and removing bot.`);
          await this.removeBot(record.id);
        }
      }
    }
  }

  /** Safely reconnect every stored, owned bot after a server restart. */
  async reconnectAll() {
    for (const record of this.storage.allBots()) {
      if (!record.ownerId) continue;
      try {
        const token = decryptToken(record.tokenEncrypted);
        if (!token) {
          console.warn(`[${record.name}] no usable token, skipping.`);
          continue;
        }
        await this.spawnBot(record, token);
      } catch (err) {
        console.error(`[${record.name}] failed to reconnect:`, err.message);
      }
    }
  }

  serialize(id) {
    const record = this.storage.getBot(id);
    if (!record) return null;
    const client = this.instances.get(id)?.client;
    let status = 'offline';
    if (client) status = client.isReady() ? 'online' : 'connecting';
    const template = getTemplate(record.templateId);
    return {
      id: record.id,
      name: record.name,
      tag: record.tag,
      avatar: record.avatar,
      templateId: record.templateId,
      templateName: template?.name ?? record.templateId,
      templateIcon: template?.icon ?? '🤖',
      accent: template ? `#${template.accent.toString(16).padStart(6, '0')}` : '#5865f2',
      status,
      guilds: client?.guilds.cache.size ?? 0,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      inviteUrl: inviteUrl(record.id, record.templateId),
    };
  }

  list(ownerId) {
    return this.storage.listBots(ownerId).map((r) => this.serialize(r.id)).filter(Boolean);
  }
}
