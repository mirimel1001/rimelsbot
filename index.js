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

const { Client, GatewayIntentBits, Collection, ActivityType, Events, Partials } = require('discord.js');
const mongoose = require('mongoose');
const Guild = require('./models/Guild');
const Token = require('./models/Token');
const dmHandler = require('./utils/dmHandler');

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
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel],
  allowedMentions: { repliedUser: false }
});

client.commands = new Collection();
client.aliases = new Collection();
client.cooldowns = new Collection();
client.werewolfGames = new Map();
client.nameGuesserGames = new Map();

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
                msg = msg.replace(/{user}/g, member.toString())
                         .replace(/{role}/g, `<@&${config.roleId}>`)
                         .replace(/{name}/g, config.name);
                
                const logMsg = await logChan.send(msg).catch(() => null);
                if (logMsg && config.deleteLog) {
                  setTimeout(() => logMsg.delete().catch(() => null), (config.deleteTime || 60) * 1000);
                }
              }
            }

            if (config.adminLogChannel) {
              const adminChan = member.guild.channels.cache.get(config.adminLogChannel);
              if (adminChan && adminChan.permissionsFor(client.user)?.has('SendMessages')) {
                const logContent = `${member.id} | ${member} - ${config.name} - <@&${config.roleId}>`;
                const embed = new EmbedBuilder()
                  .setTitle('🛡️ Activity Role Issued')
                  .setColor('#5865F2')
                  .setDescription(logContent)
                  .setTimestamp();
                adminChan.send({ embeds: [embed] }).catch(() => null);
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
    } catch (e) {}
  }
};
setInterval(checkMaxBalances, 3 * 60 * 60 * 1000);

// --- EVENT HANDLERS ---
client.once(Events.ClientReady, async () => {
  console.log(`Logged in as ${client.user.tag}!`);
  await loadCaches();
  checkMaxBalances();
  setInterval(() => {
    try {
      const servers = client.guilds.cache.size;
      const statusPath = path.join(__dirname, 'bot_status.json');
      if (fs.existsSync(statusPath)) {
        const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        const s = statusData[Math.floor(Math.random() * statusData.length)];
        client.user.setPresence({ activities: [{ name: s.name.replace('{prefix}', getConfig().prefix).replace('{servers}', servers), type: ActivityType[s.type] }], status: 'online' });
      }
    } catch (e) {}
  }, 60000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.guild) verifyActivity(message.member, message.channel);
  
  const prefix = (message.guild ? (client.prefixes.get(message.guild.id) || getConfig().prefix) : getConfig().prefix);
  
  // Use the new DM/Game Handler
  const wasHandled = await dmHandler(client, message, prefix, getConfig);
  if (wasHandled) return;

  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const input = args.shift().toLowerCase();
  const cmdName = client.commands.get(input) ? input : client.aliases.get(input);
  const command = client.commands.get(cmdName);
  
  if (!command) return;
  try { await command.run(client, message, args, prefix, getConfig()); } 
  catch (e) { console.error(e); message.reply('❌ Command Error.'); }
});

client.login(process.env.DISCORD_TOKEN);
