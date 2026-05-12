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
  // Only print to console if it's NOT a repetitive debug/background message
  const isDebug = msg.toLowerCase().includes('maxbalance') || 
                  msg.toLowerCase().includes('[cache]') || 
                  msg.toLowerCase().includes('[loader]');
  
  if (!isDebug) {
    originalLog(...args);
  }
};
console.error = (...args) => {
  const msg = args.join(' ');
  originalError(...args);
  writeToFile(`ERROR: ${msg}`);
};
console.warn = (...args) => {
  const msg = args.join(' ');
  writeToFile(`WARN: ${msg}`);
  // Only print to console if it's NOT a repetitive debug/background message
  if (!msg.toLowerCase().includes('maxbalance')) {
    originalWarn(...args);
  }
};
// -------------------

// --- AUTO-INITIALIZATION (SELF-HEALING) ---
// --- AUTO-INITIALIZATION (SELF-HEALING & MIGRATION) ---
const initFiles = () => {
  const getPath = (file) => path.join(__dirname, file);

  // 1. Migration Logic (Run once if old files exist)
  const customPath = getPath('custom_guilds.json');
  if (!fs.existsSync(customPath)) {
    console.log('[Migration] Centralizing server settings into custom_guilds.json...');
    const customData = {
      "_comment_tokens": "All server-specific UnbelievaBoat API tokens are stored here.",
      "unbTokens": {},
      "_comment_guilds": "Individual server configurations (prefixes, game settings, win rates, etc.)",
      "guilds": {}
    };

    // Migrate Prefixes
    const prefixPath = getPath('server_prefixes.json');
    if (fs.existsSync(prefixPath)) {
      try {
        const prefixes = JSON.parse(fs.readFileSync(prefixPath, 'utf8'));
        for (const [id, prefix] of Object.entries(prefixes)) {
          if (!customData.guilds[id]) customData.guilds[id] = {};
          customData.guilds[id].prefix = prefix;
        }
      } catch (e) {}
    }

    // Migrate Game Settings
    const settingsPath = getPath('server_game_settings.json');
    if (fs.existsSync(settingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        if (settings.guilds) {
          for (const [id, data] of Object.entries(settings.guilds)) {
            if (!customData.guilds[id]) customData.guilds[id] = {};
            customData.guilds[id].gameSettings = data;
          }
        }
      } catch (e) {}
    }

    // Migrate Prize Configs
    const prizePath = getPath('server_prize_configs.json');
    if (fs.existsSync(prizePath)) {
      try {
        const prizes = JSON.parse(fs.readFileSync(prizePath, 'utf8'));
        if (prizes.guilds) {
          for (const [id, data] of Object.entries(prizes.guilds)) {
            if (!customData.guilds[id]) customData.guilds[id] = {};
            customData.guilds[id].prizeConfigs = data;
          }
        }
      } catch (e) {}
    }

    // Migrate UNB Tokens
    const tokensPath = getPath('server_unbtokens.json');
    if (fs.existsSync(tokensPath)) {
      try {
        const tokens = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
        if (tokens.tokens) {
          for (const [id, token] of Object.entries(tokens.tokens)) {
            customData.unbTokens[id] = token;
          }
        }
      } catch (e) {}
    }

    // Migrate Winning Rates
    const ratesPath = getPath('server_winning_rates.json');
    if (fs.existsSync(ratesPath)) {
      try {
        const rates = JSON.parse(fs.readFileSync(ratesPath, 'utf8'));
        if (rates.guilds) {
          for (const [id, data] of Object.entries(rates.guilds)) {
            if (!customData.guilds[id]) customData.guilds[id] = {};
            customData.guilds[id].winningRates = data;
          }
        }
      } catch (e) {}
    }

    fs.writeFileSync(customPath, JSON.stringify(customData, null, 2));
    console.log('[Migration] custom_guilds.json created!');
    
    // Cleanup old server files
    ['server_prefixes.json', 'server_game_settings.json', 'server_prize_configs.json', 'server_unbtokens.json', 'server_winning_rates.json', 'server_config.json'].forEach(file => {
      if (fs.existsSync(getPath(file))) fs.unlinkSync(getPath(file));
    });
  }

  // 2. Default Server Config Migration
  const defaultPath = getPath('default_myserver.json');
  if (!fs.existsSync(defaultPath)) {
    console.log('[Migration] Creating default_myserver.json...');
    const defaultData = {
      "_comment_info": "Detailed settings for the bot's default behavior.",
      "gameSettings": {
        "_comment": "Default cooldowns (in ms) for minigames",
        "delays": { "highlow": 60000, "imageguess": 30000, "bet": 30000 }
      },
      "winningRates": {
        "_comment": "Default winning rates for specific roles (Role ID -> Percentage)",
        "highlow": {
          "551413333765652481": 45,
          "1447847623321976964": 55,
          "1447847601201483858": 55,
          "1447847605555167314": 65,
          "779433894600376342": 75
        }
      },
      "maxBalance": 10000000000
    };

    // Load from old defaults if they exist
    if (fs.existsSync(getPath('default_game_settings.json'))) {
      try {
        const oldSettings = JSON.parse(fs.readFileSync(getPath('default_game_settings.json'), 'utf8'));
        if (oldSettings.delays) defaultData.gameSettings.delays = oldSettings.delays;
      } catch (e) {}
    }
    if (fs.existsSync(getPath('default_winning_rates.json'))) {
      try {
        const oldRates = JSON.parse(fs.readFileSync(getPath('default_winning_rates.json'), 'utf8'));
        defaultData.winningRates = { ...defaultData.winningRates, ...oldRates };
      } catch (e) {}
    }

    fs.writeFileSync(defaultPath, JSON.stringify(defaultData, null, 2));
    ['default_game_settings.json', 'default_winning_rates.json'].forEach(f => {
      if (fs.existsSync(getPath(f))) fs.unlinkSync(getPath(f));
    });
  }

  // 3. Status Init
  const statusPath = getPath('bot_status.json');
  if (!fs.existsSync(statusPath)) {
    fs.writeFileSync(statusPath, JSON.stringify([
      { "name": "{prefix}help || Check bio for support", "type": "Watching" },
      { "name": "{prefix}help || Servers: {servers}", "type": "Watching" }
    ], null, 2));
  }

  // 2. Handle .env template
  const envPath = getPath('.env');
  if (!fs.existsSync(envPath)) {
    const template = `DISCORD_TOKEN=your_token_here
UNB_TOKEN=your_token_here
MAIN_GUILD_ID=your_id_here
PIXABAY_KEY=your_token_here_optional`;
    fs.writeFileSync(envPath, template);
    console.warn('[Init] .env file was missing! I’ve created a template for you.');
    console.warn('[Init] IMPORTANT: On WispByte, you should ideally set these as Environment Variables in the Startup tab.');
    process.exit(0); // Exit so the user can fill the .env
  }
};

// Run initialization immediately
initFiles();

// Safe module loading
let dotenv;
try {
  dotenv = require('dotenv');
  // Use override: true to ensure .env values win over system/hosting environment variables
  dotenv.config({ override: true });
  
  // Sanitize key environment variables
  if (process.env.MAIN_GUILD_ID) {
    process.env.MAIN_GUILD_ID = process.env.MAIN_GUILD_ID.trim().replace(/^["'](.+)["']$/, '$1');
  }
  if (process.env.UNB_TOKEN) {
    process.env.UNB_TOKEN = process.env.UNB_TOKEN.trim().replace(/^["'](.+)["']$/, '$1');
  }
} catch (err) {
  console.error('\n' + '='.repeat(50));
  console.error('[CRITICAL ERROR] The "dotenv" module is missing.');
  console.error('This usually means "npm install" failed during deployment.');
  console.error('Please check your Wispbyte console for NPM error logs.');
  console.error('='.repeat(50) + '\n');
  process.exit(1);
}

const { Client, GatewayIntentBits, Collection, ActivityType, Events, Partials } = require('discord.js');

// Dynamic Config Loading
// Dynamic Config Loading
const getConfig = () => {
  const customPath = path.join(__dirname, 'custom_guilds.json');
  if (fs.existsSync(customPath)) {
    const data = JSON.parse(fs.readFileSync(customPath, 'utf8'));
    return { prefix: data.globalPrefix || 'r' };
  }
  return { prefix: 'r' };
};
let config = getConfig();

// --- BOT INITIALIZATION ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel],
  allowedMentions: {
    repliedUser: false
  }
});

// Setup Collections
client.commands = new Collection();
client.aliases = new Collection();
client.cooldowns = new Collection();
client.werewolfGames = new Map();
client.nameGuesserGames = new Map();

// Setup Cache Collections
client.prefixes = new Collection();
client.gameSettings = new Collection();
client.unbTokens = new Collection();

// Populate Caches
// Populate Caches
const loadCaches = () => {
  try {
    const customData = JSON.parse(fs.readFileSync(path.join(__dirname, 'custom_guilds.json'), 'utf8'));
    
    // Load Tokens
    if (customData.unbTokens) {
      for (const [id, token] of Object.entries(customData.unbTokens)) {
        client.unbTokens.set(id, token);
      }
    }

    // Load Guild Settings
    if (customData.guilds) {
      for (const [id, data] of Object.entries(customData.guilds)) {
        if (data.prefix) client.prefixes.set(id, data.prefix);
        
        // Merge settings into a single object for the cache
        const guildSettings = {
          ...(data.gameSettings || {}),
          prizeConfigs: data.prizeConfigs || {},
          winningRates: data.winningRates || {},
          maxBalance: data.maxBalance
        };
        client.gameSettings.set(id, guildSettings);
      }
    }
    
    console.log('[Cache] Consolidated configurations loaded into memory.');
  } catch (err) {
    console.error('[Cache] Error initializing caches:', err.message);
  }
};
loadCaches();

// --- RECURSIVE COMMAND LOADER ---
const loadCommands = (dir) => {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      loadCommands(filePath);
    } else if (file.endsWith('.js')) {
      const command = require(filePath);

      if (command.name && command.run) {
        // --- DYNAMIC CATEGORY & TAGGING ---
        const relPath = path.relative(path.join(__dirname, 'cmds'), dir);
        if (!relPath) {
          command.category = 'General';
        } else if (relPath === 'minigames' || relPath.startsWith('minigames' + path.sep)) {
          command.isMinigame = true;
          // Settings are directly in cmds/minigames, Games are in subfolders
          if (relPath === 'minigames') {
            command.category = 'Game Settings';
            command.minigameType = 'Settings';
          } else {
            command.category = 'Games';
            command.minigameType = 'Games';
          }
        } else {
          command.category = relPath;
        }
        // -----------------------------------

        client.commands.set(command.name.toLowerCase(), command);

        if (command.aliases && Array.isArray(command.aliases)) {
          command.aliases.forEach(alias => {
            client.aliases.set(alias.toLowerCase(), command.name.toLowerCase());
          });
        }

        console.log(`[Loader] Loaded: ${command.name} [${command.category}]`);
      }
    }
  }
};

loadCommands(path.join(__dirname, 'cmds'));

// --- EVENTS ---
client.once(Events.ClientReady, () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Bot is flying 🚀');
  
  // Start the Max Balance monitor immediately on startup
  checkMaxBalances();

  let i = 0;
  setInterval(() => {
    try {
      config = getConfig(); // Refresh global config
      const servers = client.guilds.cache.size;
      
      // Load statuses from JSON
      let rotation = [];
      const statusPath = path.join(__dirname, 'bot_status.json');
      if (fs.existsSync(statusPath)) {
        const statusData = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
        rotation = statusData.map(s => ({
          name: s.name.replace('{prefix}', config.prefix).replace('{servers}', servers),
          type: ActivityType[s.type] || ActivityType.Watching
        }));
      }

      if (rotation.length > 0) {
        const currentStatus = rotation[i % rotation.length];
        client.user.setPresence({
          activities: [currentStatus],
          status: 'online',
        });
        i++;
      }
    } catch (err) {
      console.error('[Status Error]', err.message);
    }
  }, 60000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // Handle DMs
  if (!message.guild) {
    const prefix = getConfig().prefix;
    if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) {
      const msgLower = message.content.toLowerCase().trim();

      // Standalone skip support
      if (msgLower === 'skip' || msgLower === 'ready') {
        const game = Array.from(client.werewolfGames.values()).find(g =>
          g.players.has(message.author.id) &&
          g.players.get(message.author.id).alive &&
          (g.status === 'NIGHT' || g.status === 'DAY')
        );
        if (game) {
          const p = game.players.get(message.author.id);
          p.ready = true;
          return message.reply("✅ **Ready!** You have voted to skip this phase.");
        }

        // NameGuesser ready support
        const ngGame = Array.from(client.nameGuesserGames.values()).find(g =>
          g.players.has(message.author.id) && g.status === 'RUNNING' && g.activePlayerId !== message.author.id
        );
        if (ngGame) {
          const p = ngGame.players.get(message.author.id);
          p.ready = true;
          return message.reply("✅ **Ready!** You have voted to skip this phase.");
        }
      }

      // Standalone wsay support for Werewolves
      if (msgLower.startsWith('wsay ')) {
        const game = Array.from(client.werewolfGames.values()).find(g =>
          g.status === 'NIGHT' &&
          g.players.has(message.author.id) &&
          g.players.get(message.author.id).role === 'WEREWOLF' &&
          g.players.get(message.author.id).alive
        );
        if (game) {
          const text = message.content.slice(5).trim();
          const engine = require('./cmds/minigames/Werewolf/engine.js');
          return engine.relayChat(client, game, message.author.id, text);
        }
      }

      // Standalone kill support for Werewolves
      if (msgLower.startsWith('k ') || msgLower.startsWith('kill ')) {
        const game = Array.from(client.werewolfGames.values()).find(g =>
          g.status === 'NIGHT' &&
          g.players.has(message.author.id) &&
          g.players.get(message.author.id).role === 'WEREWOLF' &&
          g.players.get(message.author.id).alive
        );
        if (game) {
          const targetInput = message.content.split(' ').slice(1).join(' ').trim();
          if (!targetInput) return message.reply("❌ Specify a player name or number.");
          
          const werewolfCmd = require('./cmds/minigames/Werewolf/werewolf.js');
          const p = game.players.get(message.author.id);
          
          // Mimic the rww command structure to reuse logic
          const fakeArgs = ['kill', ...targetInput.split(' ')];
          return werewolfCmd.run(client, message, fakeArgs, prefix, getConfig());
        }
      }

      // Standalone scan support for Seers
      if (msgLower.startsWith('sc ') || msgLower.startsWith('scan ')) {
        const game = Array.from(client.werewolfGames.values()).find(g =>
          g.status === 'NIGHT' &&
          g.players.has(message.author.id) &&
          g.players.get(message.author.id).role === 'SEER' &&
          g.players.get(message.author.id).alive
        );
        if (game) {
          const targetInput = message.content.split(' ').slice(1).join(' ').trim();
          if (!targetInput) return message.reply("❌ Specify a player name or number.");

          const werewolfCmd = require('./cmds/minigames/Werewolf/werewolf.js');
          const fakeArgs = ['scan', ...targetInput.split(' ')];
          return werewolfCmd.run(client, message, fakeArgs, prefix, getConfig());
        }
      }

      // Standalone how (death story) support for Werewolves
      if (msgLower.startsWith('how ')) {
        const game = Array.from(client.werewolfGames.values()).find(g =>
          g.status === 'NIGHT' &&
          g.players.has(message.author.id) &&
          g.players.get(message.author.id).role === 'WEREWOLF' &&
          g.players.get(message.author.id).alive
        );
        if (game) {
          if (!game.lastVictim) return message.reply("⚠️ No victim has been selected yet. Decide who to kill first!");
          const text = message.content.slice(4).trim();
          const p = game.players.get(message.author.id);
          const engine = require('./cmds/minigames/Werewolf/engine.js');
          await engine.updateDeathStory(client, game, p.name, text);
          const victim = game.players.get(game.lastVictim);
          return message.reply(`📝 **Story updated!** Added your line for **${victim.name}**'s death.`);
        }
      }

      // Standalone vote support for Day phase
      if (msgLower.startsWith('v ') || msgLower.startsWith('vote ')) {
        const game = Array.from(client.werewolfGames.values()).find(g =>
          g.status === 'DAY' &&
          g.players.has(message.author.id) &&
          g.players.get(message.author.id).alive
        );
        if (game) {
          const targetInput = message.content.split(' ').slice(1).join(' ').trim();
          if (!targetInput) return message.reply("❌ Specify a player name or number.");
          const werewolfCmd = require('./cmds/minigames/Werewolf/werewolf.js');
          const fakeArgs = ['vote', ...targetInput.split(' ')];
          return werewolfCmd.run(client, message, fakeArgs, prefix, getConfig());
        }

        // NameGuesser vote support
        const ngGame = Array.from(client.nameGuesserGames.values()).find(g =>
          g.status === 'RUNNING' && g.players.has(message.author.id) && g.activePlayerId !== message.author.id
        );
        if (ngGame) {
          const targetInput = message.content.split(' ').slice(1).join(' ').trim();
          const nameGuesserCmd = require('./cmds/minigames/NameGuesser/nameguesser.js');
          const fakeArgs = ['vote', ...targetInput.split(' ')];
          return nameGuesserCmd.run(client, message, fakeArgs, 'ng', getConfig());
        }
      }

      // Standalone unvote support
      if (msgLower === 'unvote' || msgLower === 'retract') {
        const game = Array.from(client.werewolfGames.values()).find(g =>
          g.status === 'DAY' &&
          g.players.has(message.author.id) &&
          g.players.get(message.author.id).alive
        );
        if (game) {
          const werewolfCmd = require('./cmds/minigames/Werewolf/werewolf.js');
          const fakeArgs = ['unvote'];
          return werewolfCmd.run(client, message, fakeArgs, prefix, getConfig());
        }
      }

      // Standalone guess support for NameGuesser
      if (msgLower.startsWith('g ') || msgLower.startsWith('guess ')) {
        const game = Array.from(client.nameGuesserGames.values()).find(g =>
          g.status === 'RUNNING' && g.players.has(message.author.id)
        );
        if (game) {
          const targetInput = message.content.split(' ').slice(1).join(' ').trim();
          const nameGuesserCmd = require('./cmds/minigames/NameGuesser/nameguesser.js');
          const fakeArgs = ['guess', ...targetInput.split(' ')];
          return nameGuesserCmd.run(client, message, fakeArgs, 'ng', getConfig());
        }
      }

      // Standalone host commands for NameGuesser
      const standaloneHostCmds = ['launch', 'cancel', 'edit', 'add'];
      if (standaloneHostCmds.includes(msgLower)) {
        const game = Array.from(client.nameGuesserGames.values()).find(g => g.host === message.author.id);
        if (game) {
          const nameGuesserCmd = require('./cmds/minigames/NameGuesser/nameguesser.js');
          return nameGuesserCmd.run(client, message, [msgLower], 'ng', getConfig());
        }
      }

      // Standalone NameGuesser support (e.g. "ng launch" or "ng join")
      const ngMatch = message.content.match(/^ng(?:\s+(.*)|$)/i);
      
      if (ngMatch) {
        const game = Array.from(client.nameGuesserGames.values()).find(g =>
          g.host === message.author.id || g.players.has(message.author.id)
        );
        if (game) {
          const args = ngMatch[1] ? ngMatch[1].trim().split(/ +/) : [];
          const nameGuesserCmd = require('./cmds/minigames/NameGuesser/nameguesser.js');
          return nameGuesserCmd.run(client, message, args, 'ng', getConfig());
        }
      }

      // Standalone question support for NameGuesser (if it's their turn)
      const ngQuestionGame = Array.from(client.nameGuesserGames.values()).find(g =>
        g.status === 'RUNNING' && g.activePlayerId === message.author.id && !g.currentQuestion
      );
      if (ngQuestionGame) {
        const engine = require('./cmds/minigames/NameGuesser/engine.js');
        return engine.processQuestion(client, ngQuestionGame, message.content);
      }

      return; // Ignore non-command, non-game DMs
    }

  }

  const prefix = (message.guild ? (client.prefixes.get(message.guild.id) || config.prefix) : config.prefix);

  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandInput = args.shift().toLowerCase();

  const commandName = client.commands.get(commandInput)
    ? commandInput
    : client.aliases.get(commandInput);

  const command = client.commands.get(commandName);

  if (!command) return;

  // --- GAME CHANNEL RESTRICTION ---
  if (message.guild && (command.isMinigame || command.category === 'minigame')) {
    try {
      let gameChannelId = null;
      
      // Load Defaults (Fast check)
      const defaultPath = path.join(__dirname, 'default_myserver.json');
      if (fs.existsSync(defaultPath)) {
        const defaults = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
        gameChannelId = defaults.gameSettings?.gameChannel || null;
      }

      // Load Guild Settings (From Cache)
      const guildSettings = client.gameSettings.get(message.guild.id);
      if (guildSettings?.gameChannel) {
        gameChannelId = guildSettings.gameChannel;
      }

      // Verify channel actually exists in this guild
      if (gameChannelId && message.channel.id !== gameChannelId) {
        const channelExists = message.guild.channels.cache.has(gameChannelId);
        if (channelExists) {
          return message.reply(`🚫 Minigames are restricted to <#${gameChannelId}> on this server.`);
        }
      }
    } catch (err) {
      console.error('Game Channel Check Error:', err.message);
    }
  }
  // --------------------------------

  try {
    await command.run(client, message, args, prefix, config);
  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    message.reply('❌ There was an error trying to execute that command!');
  }
});

// --- MAX BALANCE MONITOR ---
const checkMaxBalances = async () => {
  if (!client.isReady()) return;

  const customPath = path.join(__dirname, 'custom_guilds.json');
  const defaultPath = path.join(__dirname, 'default_myserver.json');
  if (!fs.existsSync(customPath) || !fs.existsSync(defaultPath)) return;

  const customData = JSON.parse(fs.readFileSync(customPath, 'utf8'));
  const defaultData = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
  const axios = require('axios');
  const { getEconomyToken, enforceMaxBalance, formatNumber } = require('./utils/economy.js');

  // Iterate over all guilds the bot is currently in
  for (const [guildId, guild] of client.guilds.cache) {
    const guildData = customData.guilds[guildId] || {};
    let maxBal = guildData.maxBalance;
    
    // Debug info
    console.log(`[MaxBalance Debug] Checking guild: ${guild.name} (${guildId}) | Config MaxBal: ${formatNumber(maxBal)} | Main Guild Env: ${process.env.MAIN_GUILD_ID}`);

    if (maxBal === false) continue;
    if (maxBal === undefined) {
      const mainGuildId = process.env.MAIN_GUILD_ID?.trim().replace(/^["'](.+)["']$/, '$1');
      if (guildId === mainGuildId) {
        maxBal = defaultData.maxBalance;
      } else {
        continue; 
      }
    }

    const token = getEconomyToken(client, guildId);
    if (!token) {
      console.warn(`[MaxBalance] No token found for guild ${guild.name} (${guildId}). Skipping.`);
      continue;
    }

    try {
      // 1. Get Top 100 User IDs from leaderboard
      const lbRes = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${guildId}/leaderboard?limit=100`, {
        headers: { 'Authorization': token }
      });

      const topUserIds = lbRes.data.users?.map(u => u.id || u.user_id).filter(id => id) || [];
      console.log(`[MaxBalance] Found ${topUserIds.length} potential users to audit in ${guild.name}. Limit: ${formatNumber(maxBal)}`);

      // 2. Audit each user individually for 100% accuracy
      for (const userId of topUserIds) {
        await enforceMaxBalance(client, guildId, userId);
        // Small sleep to prevent aggressive rate-limiting
        await new Promise(r => setTimeout(r, 500));
      }
    } catch (err) {
      if (err.response?.status !== 404) {
        console.error(`[MaxBalance Error] Guild ${guild.name} (${guildId}):`, err.message);
      }
    }
  }
};

// Reasonable cooldown: Every 3 hours to stay within API limits and Discord policy
setInterval(checkMaxBalances, 3 * 60 * 60 * 1000);

// --- LOGIN ---
let token = process.env.DISCORD_TOKEN;
if (!token || token === 'your_token_here') {
  console.error('[Error] DISCORD_TOKEN is missing or still set to the template value.');
} else {
  // Sanitize token: trim whitespace and remove potential surrounding quotes
  token = token.trim().replace(/^["'](.+)["']$/, '$1');
  
  client.login(token).catch(err => {
    console.error('[Error] Failed to login to Discord:', err.message);
    if (err.message.includes('invalid token')) {
      console.error('[Debug Info] Token length:', token.length);
      console.error('[Debug Info] Ensure you have uploaded the correct .env file AND checked the "Startup" tab on Wispbyte.');
    }
  });
}

