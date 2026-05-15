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
    .then(() => console.log('[Database] Connected to MongoDB Atlas!'))
    .catch(err => console.error('[Database] Connection Error:', err.message));
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

// --- ACTIVITY ROLE LOGIC ---
const ARCANE_LEVEL_1_ROLE_ID = '123456789012345678';
const verifyActivity = async (member, channel) => {
  if (!member || member.user.bot || !channel) return;
  const cooldownKey = `${member.guild.id}-${member.id}`;
  const lastCheck = client.arCooldowns.get(cooldownKey);
  if (lastCheck && Date.now() - lastCheck < 5 * 60 * 1000) return;

  const configs = client.arConfigs.get(member.guild.id) || [];
  const eligibleRoles = configs.filter(conf => !member.roles.cache.has(conf.roleId) && member.roles.cache.has(ARCANE_LEVEL_1_ROLE_ID));
  if (eligibleRoles.length === 0) return;

  try {
    client.arCooldowns.set(cooldownKey, Date.now());
    const messages = await channel.messages.fetch({ limit: 100 });
    const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000);
    const userCount = messages.filter(m => m.author.id === member.id && m.createdAt.getTime() > fourteenDaysAgo).size;

    for (const conf of eligibleRoles) {
      if (userCount >= (conf.threshold || 5)) {
        await member.roles.add(conf.roleId).catch(() => null);
        console.log(`[AR] Granted "${conf.name}" to ${member.user.tag} (Count: ${userCount})`);
      }
    }
  } catch (err) { console.error('[AR Error]', err.message); }
};

// --- CACHE SYNCHRONIZATION ---
const loadCaches = async () => {
  try {
    const guilds = await Guild.find();
    const tokens = await Token.find();
    guilds.forEach(g => {
      if (g.prefix) client.prefixes.set(g.guildId, g.prefix);
      if (g.gameSettings) client.gameSettings.set(g.guildId, g.gameSettings);
      if (g.activityRoles) client.arConfigs.set(g.guildId, g.activityRoles);
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
