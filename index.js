const fs = require('fs');
const path = require('path');
require('events').EventEmitter.defaultMaxListeners = 50;

// --- FILE LOGGER ---
const logFile = path.join(__dirname, 'bot_logs.txt');
const originalLog = console.log;
const originalError = console.error;
const originalWarn = console.warn;

const writeToFile = (msg) => {
  const timestamp = new Date().toISOString();
  fs.appendFileSync(logFile, `[${timestamp}] ${msg}\n`);
};

console.log = (...args) => {
  const msg = args.join(' ');
  writeToFile(`INFO: ${msg}`);
  const isDebug = msg.toLowerCase().includes('maxbalance') ||
    msg.toLowerCase().includes('[cache]') ||
    msg.toLowerCase().includes('[loader]');
  if (!isDebug) originalLog(...args);
};
console.error = (...args) => {
  const msg = args.join(' ');
  originalError(...args);
  writeToFile(`ERROR: ${msg}`);
};
console.warn = (...args) => {
  const msg = args.join(' ');
  writeToFile(`WARN: ${msg}`);
  if (!msg.toLowerCase().includes('maxbalance')) originalWarn(...args);
};

// --- ENV LOADING ---
const dotenv = require('dotenv');
dotenv.config({ override: true });

const { Client, GatewayIntentBits, Collection, ActivityType, Events, Partials, EmbedBuilder } = require('discord.js');
const mongoose = require('mongoose');
const Guild = require('./models/Guild');
const Token = require('./models/Token');
const Inventory = require('./models/Inventory');
const dmhandler_werewolf = require('./cmds/minigames/Werewolf/dmhandler_werewolf');
const dmhandler_nameguesser = require('./cmds/minigames/NameGuesser/dmhandler_nameguesser');
const dmhandler_hgm = require('./cmds/HGM/dmhandler_hgm');

// --- DATABASE CONNECTION ---
if (process.env.MONGO_URI) {
  mongoose.connect(process.env.MONGO_URI)
    .catch(err => console.error('[Database] Initial Connection Error:', err.message));

  const db = mongoose.connection;
  db.on('error', err => console.error('[Database] Runtime Error:', err));
  db.once('open', () => console.log('[Database] Connected to MongoDB Atlas!'));
  db.on('disconnected', () => console.warn('[Database] Disconnected. Reconnecting...'));
} else {
  console.warn('[Database] MONGO_URI not found in .env. Persistence disabled.');
}

// Global Config Fallback
const getConfig = () => ({ prefix: process.env.GLOBAL_PREFIX || 'r' });

// --- BOT INITIALIZATION ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMembers
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User],
  allowedMentions: { repliedUser: false }
});

client.commands = new Collection();
client.aliases = new Collection();
client.cooldowns = new Collection();
client.werewolfGames = new Map();
client.nameGuesserGames = new Map();
client.owners = new Set();

// Caches
client.prefixes = new Collection();
client.gameSettings = new Collection();
client.unbTokens = new Collection();
client.arConfigs = new Map();
client.arCooldowns = new Map();

// --- ACTIVITY ROLE (AR) SYSTEM ---

const verifyActivity = async (member, channel) => {
  if (!member || !member.user || member.user.bot || !member.guild || !channel) return;

  const guildConfigs = client.arConfigs.get(member.guild.id);
  if (!guildConfigs || guildConfigs.length === 0) return;

  // 1. Check Cooldown (5 minutes)
  const cooldownKey = `${member.guild.id}-${member.id}`;
  const lastCheck = client.arCooldowns.get(cooldownKey);
  const now = Date.now();

  if (lastCheck && now - lastCheck < 5 * 60 * 1000) return;

  try {
    // 2. Verify Channel Permissions
    if (!channel.isTextBased() || !channel.permissionsFor(client.user)?.has('ReadMessageHistory')) return;

    // 3. Fetch messages
    const messages = await channel.messages.fetch({ limit: 100 }).catch(() => null);
    if (!messages) return;

    const fourteenDaysAgo = now - (14 * 24 * 60 * 60 * 1000);
    const userMessages = messages.filter(m =>
      m.author.id === member.id &&
      m.createdTimestamp > fourteenDaysAgo
    );
    const count = userMessages.size;

    client.arCooldowns.set(cooldownKey, now);

    let needsSave = false;
    for (const config of guildConfigs) {
      if (!config.roleId || member.roles.cache.has(config.roleId)) continue;

      if (count >= (config.req_msgs || 5)) {
        await member.roles.add(config.roleId)
          .then(async () => {
            // Success Logs
            if (config.logChannel) {
              const logChan = config.logChannel === 'same' ? channel : member.guild.channels.cache.get(config.logChannel);

              if (logChan && logChan.permissionsFor(client.user)?.has('SendMessages')) {
                // Support placeholders: {user}, {role}, {name}
                let msg = config.customMessage || "Congrats you just got {name} role {role}!";
                msg = msg.replace(/{user}|{User Mention}/g, member.toString())
                  .replace(/{role}|{Role}/g, `<@&${config.roleId}>`)
                  .replace(/{name}|{Activity Name}/g, config.name);

                const logMsg = await logChan.send(msg).catch(() => null);
                if (logMsg && config.deleteLog) {
                  setTimeout(() => logMsg.delete().catch(() => null), (config.deleteTime || 60) * 1000);
                }
              } else if (config.logChannel !== 'same') {
                // Channel deleted or bot lacks perms - auto reset
                config.logChannel = null;
                needsSave = true;
              }
            }

            if (config.adminLogChannel) {
              const adminChan = config.adminLogChannel === 'same' ? channel : member.guild.channels.cache.get(config.adminLogChannel);

              if (adminChan && adminChan.permissionsFor(client.user)?.has('SendMessages')) {
                const logContent = `${member.id} | ${member} - ${config.name} - <@&${config.roleId}>`;
                const embed = new EmbedBuilder()
                  .setTitle('🛡️ Activity Role Issued')
                  .setColor('#5865F2')
                  .setDescription(logContent)
                  .setTimestamp();
                adminChan.send({ embeds: [embed] }).catch(() => null);
              } else if (config.adminLogChannel !== 'same') {
                // Channel deleted or bot lacks perms - auto reset
                config.adminLogChannel = null;
                needsSave = true;
              }
            }
          })
          .catch(err => {
            if (err.code === 50013) {
              console.warn(`[AR Error] Missing Permissions to add role ${config.roleId} in ${member.guild.name}`);
            } else {
              console.error(`[AR Error] Role addition failed:`, err.message);
            }
          });
      }
    }

    if (needsSave) {
      await Guild.findOneAndUpdate({ guildId: member.guild.id }, { activityRoles: guildConfigs }).catch(e => console.error('[AR DB Error]', e));
    }
  } catch (err) {
    console.error('[AR Error] Activity verification failed:', err);
  }
};

// --- CACHE SYNCHRONIZATION ---
const loadCaches = async () => {
  try {
    const guilds = await Guild.find();
    const tokens = await Token.find();
    guilds.forEach(g => {
      if (g.prefix) client.prefixes.set(g.guildId, g.prefix);
      if (g.gameSettings) client.gameSettings.set(g.guildId, g.gameSettings);
      if (g.activityRoles) {
        // Migration: Copy threshold to req_msgs if needed
        g.activityRoles.forEach(ar => {
          if (ar.req_msgs === undefined && ar.toObject().threshold !== undefined) {
            ar.req_msgs = ar.toObject().threshold;
          }
        });
        client.arConfigs.set(g.guildId, g.activityRoles);
      }
    });
    tokens.forEach(t => client.unbTokens.set(t.guildId, t.token));
    console.log(`[Cache] Synchronized ${guilds.length} guilds and ${tokens.length} custom tokens.`);
  } catch (err) { console.error('[Cache Error]', err.message); }
};

// --- COMMAND LOADER ---
const loadCommands = (dir) => {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) return loadCommands(fullPath);
    if (!file.endsWith('.js')) return;
    const cmd = require(fullPath);
    if (cmd.name && cmd.run) {
      const relPath = path.relative(path.join(__dirname, 'cmds'), dir);
      cmd.category = relPath || 'General';
      if (relPath.startsWith('minigames')) cmd.isMinigame = true;
      client.commands.set(cmd.name.toLowerCase(), cmd);
      if (cmd.aliases) cmd.aliases.forEach(a => client.aliases.set(a.toLowerCase(), cmd.name.toLowerCase()));
      console.log(`[Loader] Loaded: ${cmd.name}`);
    }
  });
};
loadCommands(path.join(__dirname, 'cmds'));

// --- MAX BALANCE MONITOR ---
const checkMaxBalances = async () => {
  if (!client.isReady()) return;
  const axios = require('axios');
  const { getEconomyToken, enforceMaxBalance } = require('./utils/economy.js');
  for (const [guildId, guild] of client.guilds.cache) {
    const settings = client.gameSettings.get(guildId) || {};
    let maxBal = settings.maxBalance;
    if (!maxBal || maxBal === false) continue;
    const token = getEconomyToken(client, guildId);
    if (!token) continue;
    try {
      const lb = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${guildId}/leaderboard?limit=100`, { headers: { 'Authorization': token } });
      const ids = lb.data.users?.map(u => u.id || u.user_id).filter(id => id) || [];
      for (const id of ids) {
        await enforceMaxBalance(client, guildId, id);
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (e) { }
  }
};
// --- TEMPORARY ROLE EXPIRATION WORKER ---
const checkExpiredRoles = async () => {
  if (!client.isReady()) return;
  const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const { getEconomyToken, formatNumber } = require('./utils/economy.js');

  try {
    const now = new Date();
    // Find all inventories with active temporary roles that have expired
    const inventories = await Inventory.find({
      "roles": {
        $elemMatch: {
          isTemporary: true,
          isUsed: true,
          expiresAt: { $lt: now }
        }
      }
    });

    for (const inv of inventories) {
      let needsSave = false;
      const toRemoveIds = [];

      for (const item of inv.roles) {
        if (item.isTemporary && item.isUsed && item.expiresAt && item.expiresAt < now) {
          const guildId = inv.guildId;
          const buyerId = inv.userId;
          const wearerId = item.assignedTo;

          // Strip role from wearer on Discord
          const guild = client.guilds.cache.get(guildId);
          if (guild) {
            const member = await guild.members.fetch(wearerId).catch(() => null);
            const role = await guild.roles.fetch(item.roleId).catch(() => null);

            if (member && role) {
              try {
                await member.roles.remove(role);
              } catch (err) {
                console.error(`[Expiration Worker] Failed to remove role ${role.name} from ${member.user.username}:`, err.message);
              }
            }

            // Mark for deletion from inventory array upon expiration
            toRemoveIds.push(item._id);
            needsSave = true;

            // Send expiration DM with renewal option
            const purchaser = await client.users.fetch(buyerId).catch(() => null);
            if (purchaser) {
              const dmEmbed = new EmbedBuilder()
                .setColor('#ED4245')
                .setTitle('⏳ Temporary Role Expired!')
                .setDescription(`Your temporary role **${item.name}** in server **${guild.name}** has expired.\nWould you like to purchase a renewal?`)
                .setTimestamp();

              // Check storefront price in Guild schema
              const guildData = await Guild.findOne({ guildId });
              const storeItem = guildData?.roleStore.find(si => si.roleId === item.roleId);

              if (storeItem) {
                dmEmbed.addFields({ name: '💰 Renewal Cost', value: `💰 ${formatNumber(storeItem.price)}` });

                const renewRow = new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(`role_renew_${item.roleId}_${guildId}`)
                    .setLabel('🔄 Renew Subscription')
                    .setStyle(ButtonStyle.Success)
                );

                await purchaser.send({ embeds: [dmEmbed], components: [renewRow] }).catch(() => null);
              } else {
                await purchaser.send({ embeds: [dmEmbed] }).catch(() => null);
              }
            }
          }
        }
      }

      if (needsSave) {
        for (const removeId of toRemoveIds) {
          inv.roles.pull(removeId);
        }
        await inv.save();
      }
    }
  } catch (err) {
    console.error('[Expiration Worker Error]', err);
  }
};
setInterval(checkExpiredRoles, 3 * 60 * 60 * 1000);
setInterval(checkMaxBalances, 3 * 60 * 60 * 1000);

// --- EVENT HANDLERS ---
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}!`);

  // Print latest Git commit message on startup to track live version
  try {
    const { execSync } = require('child_process');
    const gitMsg = execSync('git log -1 --pretty=%B').toString().trim();
    console.log(`\x1b[32m[Current Active Git Commit]:\x1b[0m ${gitMsg}\n`);
  } catch (err) {
    console.warn('[Git Status Warning] Unable to retrieve latest git commit message:', err.message);
  }

  await loadCaches();

  // Initial Web Presence synchronization
  try {
    const { syncPresence } = require('./cmds/Web/websync.js');
    await syncPresence(client);
  } catch (err) {
    console.error('[WebSync Error] Failed initial sync on ready:', err.message);
  }

  // Fetch owners dynamically
  try {
    const app = await client.application.fetch();
    if (app.owner) {
      if (app.owner.members) {
        app.owner.members.forEach(member => {
          if (member.user) client.owners.add(member.user.id);
          else if (member.id) client.owners.add(member.id);
        });
      } else {
        client.owners.add(app.owner.id);
      }
    }
    console.log(`[Owners] Loaded ${client.owners.size} owner(s) dynamically.`);
  } catch (err) {
    console.error('[Owners Error] Failed to fetch application info:', err.message);
  }

  checkMaxBalances();
  checkExpiredRoles();
  setInterval(() => {
    try {
      const servers = client.guilds.cache.size;
      const statusPath = path.join(__dirname, 'bot_status.json');
      if (fs.existsSync(statusPath)) {
        const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        const s = statusData[Math.floor(Math.random() * statusData.length)];
        client.user.setPresence({ activities: [{ name: s.name.replace('{prefix}', getConfig().prefix).replace('{servers}', servers), type: ActivityType[s.type] }], status: 'online' });
      }
    } catch (e) { }
  }, 60000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.guild) verifyActivity(message.member, message.channel);

  const prefix = (message.guild ? (client.prefixes.get(message.guild.id) || getConfig().prefix) : getConfig().prefix);

  // Use HGM DM Handler
  const hgmHandled = await dmhandler_hgm(client, message, prefix, getConfig);
  if (hgmHandled) return;

  // Use Werewolf DM Handler
  const werewolfHandled = await dmhandler_werewolf(client, message, prefix, getConfig);
  if (werewolfHandled) return;

  // Use NameGuesser DM Handler
  const nameguesserHandled = await dmhandler_nameguesser(client, message, prefix, getConfig);
  if (nameguesserHandled) return;

  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const input = args.shift().toLowerCase();
  const cmdName = client.commands.get(input) ? input : client.aliases.get(input);
  const command = client.commands.get(cmdName);

  if (!command) return;
  try { await command.run(client, message, args, prefix, getConfig()); }
  catch (e) { console.error(e); message.reply('❌ Command Error.'); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  if (interaction.customId === 'hgm_delete_list') {
    if (!client.owners.has(interaction.user.id)) {
      const { MessageFlags } = require('discord.js');
      return interaction.reply({ content: "❌ Only the bot owner can delete this list.", flags: [MessageFlags.Ephemeral] });
    }
    try {
      await interaction.message.delete();
    } catch (e) {
      console.error('[HGM Delete Error]', e);
    }
    return;
  }

  if (interaction.customId.startsWith('role_renew_')) {
    const { EmbedBuilder, MessageFlags } = require('discord.js');
    const { getEconomyToken, deductFunds, formatNumber } = require('./utils/economy.js');

    const [_, __, roleId, guildId] = interaction.customId.split('_');

    await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });

    try {
      const token = getEconomyToken(client, guildId);
      if (!token) {
        return interaction.editReply({ content: "❌ Economy settings not found for this server. Renewals are currently unavailable." });
      }

      const guildData = await Guild.findOne({ guildId });
      const storeItem = guildData?.roleStore.find(si => si.roleId === roleId);

      if (!storeItem) {
        return interaction.editReply({ content: "❌ This role is no longer listed in the server storefront." });
      }

      // Check stock
      if (storeItem.stock === 0) {
        return interaction.editReply({ content: "❌ This role is currently out of stock!" });
      }

      // Deduct balance
      const deduction = await deductFunds(
        client,
        guildId,
        interaction.user.id,
        storeItem.price,
        `Role Store Subscription Renewal: ${storeItem.name}`
      );

      if (!deduction.success) {
        return interaction.editReply({ content: deduction.error });
      }

      // Load inventory and update
      let inv = await Inventory.findOne({ guildId, userId: interaction.user.id });
      if (!inv) {
        inv = new Inventory({ guildId, userId: interaction.user.id, roles: [] });
      }

      let item = inv.roles.find(r => r.roleId === roleId);
      if (!item) {
        item = {
          roleId: storeItem.roleId,
          name: storeItem.name,
          isTemporary: storeItem.isTemporary,
          durationMs: storeItem.durationMs,
          purchasedAt: new Date(),
          isUsed: false,
          assignedTo: null
        };
        inv.roles.push(item);
        item = inv.roles[inv.roles.length - 1];
      }

      // Decrement stock if applicable
      if (storeItem.stock > 0) {
        const originalItem = guildData.roleStore.id(storeItem._id);
        if (originalItem) {
          originalItem.stock--;
          await guildData.save();
        }
      }

      // Reset timer and activate
      item.isUsed = true;
      item.assignedTo = interaction.user.id;
      item.expiresAt = new Date(Date.now() + storeItem.durationMs);

      await inv.save();

      // Assign on Discord
      const guild = client.guilds.cache.get(guildId);
      if (guild) {
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        const role = await guild.roles.fetch(roleId).catch(() => null);
        if (member && role) {
          await member.roles.add(role).catch(err => console.error('[DM Renew Role Add Error]', err.message));
        }
      }

      const successEmbed = new EmbedBuilder()
        .setColor('#43B581')
        .setTitle('🔄 Subscription Renewed!')
        .setDescription(`You successfully renewed the role **${storeItem.name}** for **💰 ${formatNumber(storeItem.price)}**!\nThe role has been equipped on yourself, and your new expiration timer is ticking.`)
        .setTimestamp();

      await interaction.editReply({ embeds: [successEmbed] });

      // Disable the button in the original DM
      try {
        await interaction.message.edit({ components: [] });
      } catch (e) { }

    } catch (err) {
      console.error('[Role Renewal Button Error]', err);
      return interaction.editReply({ content: "❌ An error occurred while renewing your subscription." });
    }
  }
});

// --- WEB SYNCHRONIZATION EVENT LISTENERS ---
client.on('presenceUpdate', (oldPresence, newPresence) => {
  try {
    const { updateSinglePresence } = require('./cmds/Web/websync.js');
    updateSinglePresence(newPresence);
  } catch (err) {
    console.error('[WebSync Event Error] presenceUpdate failed:', err.message);
  }
});

client.on('guildMemberUpdate', (oldMember, newMember) => {
  try {
    const { updateSingleMember } = require('./cmds/Web/websync.js');
    updateSingleMember(oldMember, newMember);
  } catch (err) {
    console.error('[WebSync Event Error] guildMemberUpdate failed:', err.message);
  }
});

client.login(process.env.DISCORD_TOKEN);
