import {
  SlashCommandBuilder,
  EmbedBuilder,
  PermissionsBitField,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Collection,
} from 'discord.js';

const { Flags } = PermissionsBitField;
const { Guilds, GuildMembers, GuildMessages, MessageContent } = GatewayIntentBits;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function brandEmbed(template, client) {
  return new EmbedBuilder()
    .setColor(template.accent || 0x5865f2)
    .setFooter({
      text: `BotForge · ${client.user?.username ?? 'Bot'}`,
      iconURL: client.user?.displayAvatarURL(),
    })
    .setTimestamp();
}

function hasPerm(interaction, flag) {
  return interaction.memberPermissions?.has(flag) ?? false;
}

function deny(interaction, reason = 'You do not have permission to use this command.') {
  return interaction.reply({
    content: `⛔ ${reason}`,
    ephemeral: true,
  });
}

/* ------------------------------------------------------------------ */
/* Global commands (available on every template)                       */
/* ------------------------------------------------------------------ */

function globalCommands() {
  const ping = {
    data: new SlashCommandBuilder()
      .setName('ping')
      .setDescription('Check the bot latency and API heartbeat.'),
    async execute(interaction) {
      const sent = await interaction.reply({ content: 'Pinging…', fetchReply: true });
      const ws = interaction.client.ws.ping;
      const roundTrip = sent.createdTimestamp - interaction.createdTimestamp;
      await interaction.editReply(
        `🏓 Pong!\n**Latency:** ${roundTrip}ms\n**WebSocket:** ${ws}ms`,
      );
    },
  };

  const help = {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('List everything this bot can do.'),
    async execute(interaction, ctx) {
      const template = ctx.template;
      const embed = brandEmbed(template, interaction.client).setTitle(`🤖 ${template.name}`)
        .setDescription(template.description);
      for (const group of ctx.helpGroups) {
        embed.addFields({
          name: group.title,
          value: group.commands.map((c) => `\`/${c.name}\` — ${c.shortHelp}`).join('\n'),
        });
      }
      await interaction.reply({ embeds: [embed] });
    },
  };

  const info = {
    data: new SlashCommandBuilder()
      .setName('info')
      .setDescription('Show information about this bot.'),
    async execute(interaction, ctx) {
      const { client } = interaction;
      const embed = brandEmbed(ctx.template, client)
        .setAuthor({
          name: client.user.username,
          iconURL: client.user.displayAvatarURL(),
        })
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .setDescription(ctx.template.tagline)
        .addFields(
          { name: 'Servers', value: String(client.guilds.cache.size), inline: true },
          { name: 'Uptime', value: formatUptime(client.uptime), inline: true },
          { name: 'Template', value: ctx.template.name, inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    },
  };

  return [ping, help, info];
}

function formatUptime(ms) {
  const total = Math.floor(ms / 1000);
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

/* ------------------------------------------------------------------ */
/* Template: Moderation & Welcomer                                     */
/* ------------------------------------------------------------------ */

function moderationCommands() {
  const kick = {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member from the server.')
      .addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the kick')),
    shortHelp: 'Kick a member',
    async execute(interaction) {
      if (!hasPerm(interaction, Flags.KickMembers)) return deny(interaction, 'You need the Kick Members permission.');
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
      if (!member.kickable) return interaction.reply({ content: 'I cannot kick that member.', ephemeral: true });
      await member.kick(reason);
      await interaction.reply(`✅ Kicked **${user.tag}** — ${reason}`);
    },
  };

  const ban = {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member from the server.')
      .addUserOption((o) => o.setName('user').setDescription('Member to ban').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('Reason for the ban')),
    shortHelp: 'Ban a member',
    async execute(interaction) {
      if (!hasPerm(interaction, Flags.BanMembers)) return deny(interaction, 'You need the Ban Members permission.');
      const user = interaction.options.getUser('user', true);
      const reason = interaction.options.getString('reason') ?? 'No reason provided';
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (member && !member.bannable) return interaction.reply({ content: 'I cannot ban that member.', ephemeral: true });
      await interaction.guild.members.ban(user, { reason });
      await interaction.reply(`🔨 Banned **${user.tag}** — ${reason}`);
    },
  };

  const clear = {
    data: new SlashCommandBuilder()
      .setName('clear')
      .setDescription('Bulk delete recent messages in this channel.')
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('Messages to delete (1-100)').setRequired(true).setMinValue(1).setMaxValue(100),
      ),
    shortHelp: 'Purge messages',
    async execute(interaction) {
      if (!hasPerm(interaction, Flags.ManageMessages)) return deny(interaction, 'You need the Manage Messages permission.');
      const amount = interaction.options.getInteger('amount', true);
      await interaction.deferReply({ ephemeral: true });
      const deleted = await interaction.channel.bulkDelete(amount, true).catch(() => null);
      if (!deleted) return interaction.followUp({ content: 'Failed to delete messages (they may be older than 14 days).', ephemeral: true });
      await interaction.followUp({ content: `🧹 Deleted ${deleted.size} message(s).`, ephemeral: true });
    },
  };

  const autorole = {
    data: new SlashCommandBuilder()
      .setName('autorole')
      .setDescription('Manage the role auto-assigned to new members.')
      .addSubcommand((s) =>
        s.setName('set').setDescription('Choose a role to assign on join.')
          .addRoleOption((o) => o.setName('role').setDescription('Role to auto-assign').setRequired(true)),
      )
      .addSubcommand((s) => s.setName('clear').setDescription('Disable auto-role.')),
    shortHelp: 'Auto-assign a role on join',
    async execute(interaction, ctx) {
      if (!hasPerm(interaction, Flags.ManageRoles)) return deny(interaction, 'You need the Manage Roles permission.');
      const sub = interaction.options.getSubcommand();
      if (sub === 'set') {
        const role = interaction.options.getRole('role', true);
        ctx.store.autoroles.set(interaction.guild.id, role.id);
        await interaction.reply(`✅ New members will now receive **@${role.name}**.`);
      } else {
        ctx.store.autoroles.delete(interaction.guild.id);
        await interaction.reply('🔕 Auto-role disabled.');
      }
    },
  };

  return [kick, ban, clear, autorole];
}

function setupModeration(ctx) {
  const { client, template } = ctx;
  const store = ctx.store;

  client.on('guildMemberAdd', async (member) => {
    try {
      // Auto-role
      const roleId = store.autoroles.get(member.guild.id);
      if (roleId) {
        const role = member.guild.roles.cache.get(roleId);
        if (role && role.editable) await member.roles.add(role).catch(() => {});
      }

      // Welcome embed — target a channel named #welcome if it exists,
      // otherwise the guild's system channel.
      const channel =
        member.guild.channels.cache.find(
          (c) => c.name === 'welcome' || c.name === 'welcome-and-goodbye',
        ) ?? member.guild.systemChannel;

      if (!channel) return;

      const embed = brandEmbed(template, client)
        .setColor(0x57f287)
        .setTitle(`👋 Welcome to ${member.guild.name}!`)
        .setDescription(`Hey ${member}, you are member **#${member.guild.memberCount}**. Enjoy your stay!`)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Roles', value: roleId ? 'Auto-role assigned 🎉' : 'None assigned', inline: true },
        );

      await channel.send({ embeds: [embed] }).catch(() => {});
    } catch {
      /* never let a welcome handler crash the client */
    }
  });
}

/* ------------------------------------------------------------------ */
/* Template: Community Engagement (XP / levels + polling)              */
/* ------------------------------------------------------------------ */

function engagementCommands() {
  const level = {
    data: new SlashCommandBuilder()
      .setName('level')
      .setDescription("Check a member's XP and level.")
      .addUserOption((o) => o.setName('user').setDescription('Member to check (defaults to you)')),
    shortHelp: "View a member's level",
    async execute(interaction, ctx) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const entry = ctx.store.xp.ensure(interaction.guild.id, user.id);
      const next = xpForNext(entry.level);
      const embed = brandEmbed(ctx.template, interaction.client)
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setDescription(`**Level ${entry.level}** · ${entry.xp}/${next} XP`)
        .addFields({ name: 'Progress', value: progressBar(entry.xp, next), inline: false });
      await interaction.reply({ embeds: [embed] });
    },
  };

  const leaderboard = {
    data: new SlashCommandBuilder()
      .setName('leaderboard')
      .setDescription('Show the top members by XP in this server.'),
    shortHelp: 'Show the XP leaderboard',
    async execute(interaction, ctx) {
      const rows = ctx.store.xp.top(interaction.guild.id, 10);
      if (!rows.length) return interaction.reply('No XP recorded yet — start chatting!');
      const medal = ['🥇', '🥈', '🥉'];
      const lines = rows.map((r, i) => {
        const place = medal[i] ?? `#${i + 1}`;
        return `${place} <@${r.userId}> — **Level ${r.level}** (${r.xp} XP)`;
      });
      const embed = brandEmbed(ctx.template, interaction.client)
        .setTitle('🏆 XP Leaderboard')
        .setDescription(lines.join('\n'));
      await interaction.reply({ embeds: [embed] });
    },
  };

  const poll = {
    data: new SlashCommandBuilder()
      .setName('poll')
      .setDescription('Start a poll with reactions.')
      .addStringOption((o) => o.setName('question').setDescription('What to ask').setRequired(true))
      .addStringOption((o) =>
        o.setName('options').setDescription('Comma-separated options (max 5)').setRequired(true),
      ),
    shortHelp: 'Create a reaction poll',
    async execute(interaction, ctx) {
      const question = interaction.options.getString('question', true);
      const raw = interaction.options.getString('options', true);
      const options = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 5);
      if (options.length < 2) return interaction.reply({ content: 'Provide at least 2 options, comma-separated.', ephemeral: true });

      const emojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣'];
      const embed = brandEmbed(ctx.template, interaction.client)
        .setTitle(`📊 ${question}`)
        .setDescription(options.map((opt, i) => `${emojis[i]} ${opt}`).join('\n'))
        .setFooter({ text: `Poll by ${interaction.user.username}` });

      await interaction.deferReply();
      const message = await interaction.editReply({ embeds: [embed] });
      for (let i = 0; i < options.length; i += 1) {
        await message.react(emojis[i]).catch(() => {});
      }
    },
  };

  return [level, leaderboard, poll];
}

function setupEngagement(ctx) {
  const { client, template, store } = ctx;
  const cooldowns = new Map();

  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    // Rate-limit XP grants per user to avoid spam farming.
    const now = Date.now();
    const last = cooldowns.get(message.author.id) ?? 0;
    if (now - last < 30_000) return;
    cooldowns.set(message.author.id, now);

    const entry = store.xp.ensure(message.guild.id, message.author.id);
    const gained = 15 + Math.floor(Math.random() * 11); // 15-25 XP
    entry.xp += gained;

    const next = xpForNext(entry.level);
    if (entry.xp >= next) {
      entry.xp -= next;
      entry.level += 1;
      const embed = brandEmbed(template, client)
        .setColor(0xfee75c)
        .setTitle('🎉 Level up!')
        .setDescription(`${message.author}, you reached **Level ${entry.level}**!`);
      await message.channel.send({ embeds: [embed] }).catch(() => {});
    }
  });
}

function xpForNext(level) {
  return 100 + level * 100;
}

function progressBar(value, max, length = 12) {
  const filled = Math.max(1, Math.round((value / max) * length));
  return '▰'.repeat(filled) + '▱'.repeat(Math.max(0, length - filled));
}

/* ------------------------------------------------------------------ */
/* Template: Music / Utility                                           */
/* ------------------------------------------------------------------ */

function utilityCommands() {
  const serverinfo = {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show details about this server.'),
    shortHelp: 'Server statistics',
    async execute(interaction, ctx) {
      const g = interaction.guild;
      const embed = brandEmbed(ctx.template, interaction.client)
        .setAuthor({ name: g.name, iconURL: g.iconURL() })
        .setThumbnail(g.iconURL({ size: 256 }))
        .addFields(
          { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
          { name: 'Members', value: String(g.memberCount), inline: true },
          { name: 'Channels', value: String(g.channels.cache.size), inline: true },
          { name: 'Roles', value: String(g.roles.cache.size), inline: true },
          { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Boost level', value: String(g.premiumTier), inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    },
  };

  const userinfo = {
    data: new SlashCommandBuilder()
      .setName('userinfo')
      .setDescription('Show details about a member.')
      .addUserOption((o) => o.setName('user').setDescription('Member to inspect (defaults to you)')),
    shortHelp: 'Member details',
    async execute(interaction, ctx) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      const embed = brandEmbed(ctx.template, interaction.client)
        .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .addFields(
          { name: 'Tag', value: user.tag, inline: true },
          { name: 'Joined', value: member ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'N/A', inline: true },
          { name: 'Registered', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
          { name: 'Roles', value: member ? String(member.roles.cache.size - 1) : 'N/A', inline: true },
        );
      await interaction.reply({ embeds: [embed] });
    },
  };

  const avatar = {
    data: new SlashCommandBuilder()
      .setName('avatar')
      .setDescription("Show a user's avatar.")
      .addUserOption((o) => o.setName('user').setDescription('User to fetch (defaults to you)')),
    shortHelp: "Fetch a user's avatar",
    async execute(interaction) {
      const user = interaction.options.getUser('user') ?? interaction.user;
      const embed = new EmbedBuilder()
        .setTitle(`${user.username}'s avatar`)
        .setImage(user.displayAvatarURL({ size: 1024 }))
        .setColor(0x5865f2);
      await interaction.reply({ embeds: [embed] });
    },
  };

  const uptime = {
    data: new SlashCommandBuilder().setName('uptime').setDescription('How long has the bot been online?'),
    shortHelp: 'Bot uptime',
    async execute(interaction) {
      await interaction.reply(`⏱️ Uptime: **${formatUptime(interaction.client.uptime)}**`);
    },
  };

  return [serverinfo, userinfo, avatar, uptime];
}

/* ------------------------------------------------------------------ */
/* Template registry                                                   */
/* ------------------------------------------------------------------ */

export const TEMPLATES = [
  {
    id: 'moderation',
    name: 'Moderation & Welcomer',
    icon: '🛡️',
    accent: 0x5865f2,
    tagline: 'Keep your server safe and welcoming.',
    description:
      'Auto-assign roles to new members, greet them with a rich welcome embed, and moderate with slash commands.',
    features: ['Auto-role on join', 'Rich welcome embeds', '/kick /ban /clear', '/autorole'],
    permissions: [
      Flags.KickMembers, Flags.BanMembers, Flags.ManageRoles,
      Flags.ManageMessages, Flags.SendMessages, Flags.EmbedLinks,
      Flags.ReadMessageHistory, Flags.ViewChannel, Flags.AddReactions,
    ],
    intents: [Guilds, GuildMembers, GuildMessages, MessageContent],
    commands: moderationCommands,
    setup: setupModeration,
  },
  {
    id: 'engagement',
    name: 'Community Engagement',
    icon: '🔥',
    accent: 0xfee75c,
    tagline: 'Gamify activity and run polls.',
    description:
      'A lightweight XP / leveling system that rewards chatting, plus a reaction-based polling command and leaderboards.',
    features: ['XP & leveling system', '/leaderboard', '/poll', '/level'],
    permissions: [
      Flags.SendMessages, Flags.EmbedLinks, Flags.ReadMessageHistory,
      Flags.ViewChannel, Flags.AddReactions, Flags.UseExternalEmojis,
    ],
    intents: [Guilds, GuildMessages, MessageContent],
    commands: engagementCommands,
    setup: setupEngagement,
  },
  {
    id: 'utility',
    name: 'Music / Utility Bot',
    icon: '🎧',
    accent: 0x57f287,
    tagline: 'Server status and handy utility tools.',
    description:
      'Quick server/member/avatar lookup commands and uptime reporting for your community.',
    features: ['/serverinfo', '/userinfo', '/avatar', '/uptime'],
    permissions: [
      Flags.SendMessages, Flags.EmbedLinks, Flags.ReadMessageHistory,
      Flags.ViewChannel, Flags.AddReactions, Flags.UseExternalEmojis,
    ],
    intents: [Guilds, GuildMembers],
    commands: utilityCommands,
    setup: () => {},
  },
];

export function getTemplate(id) {
  return TEMPLATES.find((t) => t.id === id) ?? null;
}

export function getTemplateMeta() {
  return TEMPLATES.map(({ id, name, icon, accent, tagline, description, features }) => ({
    id,
    name,
    icon,
    accent: `#${accent.toString(16).padStart(6, '0')}`,
    tagline,
    description,
    features,
  }));
}

/**
 * Build the full command list for a template: global commands + template commands.
 * Each entry is { data, execute, shortHelp }.
 */
export function buildCommands(templateId) {
  const template = getTemplate(templateId) ?? TEMPLATES[0];
  return [...globalCommands(), ...template.commands()];
}

/**
 * Compute the OAuth2 permissions integer for a template's invite link.
 */
export function permissionsBitfield(templateId) {
  const template = getTemplate(templateId) ?? TEMPLATES[0];
  return template.permissions.reduce((acc, flag) => acc | flag, 0n);
}
