require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, ActivityType, Events } = require('discord.js');

// --- AUTO-INITIALIZATION ---
const initFiles = () => {
  const files = {
    'server_config.json': { prefix: 'r' },
    'server_prefixes.json': {},
    'default_winning_rates.json': {
      "551413333765652481": 45,
      "1447847623321976964": 55,
      "1447847601201483858": 55,
      "1447847605555167314": 65,
      "779433894600376342": 75
    },
    'server_winning_rates.json': { guilds: {} },
    'server_prize_configs.json': { guilds: {} },
    'default_game_settings.json': {
      delays: {
        highlow: 40000,
        imageguess: 30000
      }
    },
    'server_game_settings.json': { guilds: {} },
    'bot_status.json': [
      { "name": "{prefix}help || Check bio for support", "type": "Watching" },
      { "name": "{prefix}help || Servers: {servers}", "type": "Watching" }
    ]
  };

  // 1. Handle JSON files
  for (const [filename, content] of Object.entries(files)) {
    if (!fs.existsSync(filename)) {
      fs.writeFileSync(filename, JSON.stringify(content, null, 2));
      console.log(`[Init] Created missing file: ${filename}`);
    }
  }

  // 2. Handle .env template
  if (!fs.existsSync('.env')) {
    const template = `DISCORD_TOKEN=your_token_here
UNB_TOKEN=your_token_here
PIXABAY_KEY=your_token_here_optional`;
    fs.writeFileSync('.env', template);
    console.warn('[Init] .env file was missing! I’ve created a template for you. Please fill in your tokens and restart.');
    process.exit(0); // Exit so the user can fill the .env
  }
};

initFiles();
require('dotenv').config();

// Dynamic Config Loading
const getConfig = () => JSON.parse(fs.readFileSync('./server_config.json', 'utf8'));
let config = getConfig();

// --- BOT INITIALIZATION ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Setup Collections
client.commands = new Collection();
client.aliases = new Collection();
client.cooldowns = new Collection();
client.werewolfGames = new Map();

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
          command.category = relPath === 'minigames' ? 'Minigames' : relPath.split(path.sep)[1];
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

  let i = 0;
  setInterval(() => {
    try {
      config = getConfig(); // Refresh global config
      const servers = client.guilds.cache.size;
      
      // Load statuses from JSON
      let rotation = [];
      if (fs.existsSync('./bot_status.json')) {
        const statusData = JSON.parse(fs.readFileSync('./bot_status.json', 'utf8'));
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
      // Werewolf DM Relay (Pack Chat)
      const game = Array.from(client.werewolfGames.values()).find(g =>
        g.status === 'NIGHT' &&
        g.players.has(message.author.id) &&
        g.players.get(message.author.id).role === 'WEREWOLF' &&
        g.players.get(message.author.id).alive
      );
      if (game) {
        const engine = require('./cmds/minigames/Werewolf/engine.js');
        return engine.relayChat(client, game, message.author.id, message.content);
      }
      return; // Ignore non-command, non-game DMs
    }
  }

  // Refresh config and handle prefixes
  config = getConfig();
  let prefixes = {};
  if (message.guild) {
    try {
      prefixes = JSON.parse(fs.readFileSync('./server_prefixes.json', 'utf8'));
    } catch (err) {
      console.error('Error reading server_prefixes.json:', err.message);
    }
  }

  const prefix = (message.guild ? (prefixes[message.guild.id] || config.prefix) : config.prefix);

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
      
      // Load Defaults
      if (fs.existsSync('./default_game_settings.json')) {
        const defaults = JSON.parse(fs.readFileSync('./default_game_settings.json', 'utf8'));
        gameChannelId = defaults.gameChannel || null;
      }

      // Load Guild Settings (Overrides)
      if (fs.existsSync('./server_game_settings.json')) {
        const gameSettings = JSON.parse(fs.readFileSync('./server_game_settings.json', 'utf8'));
        const guildChannel = gameSettings.guilds[message.guild.id]?.gameChannel;
        if (guildChannel) gameChannelId = guildChannel;
      }

      if (gameChannelId && message.channel.id !== gameChannelId) {
        return message.reply(`🚫 Minigames are restricted to <#${gameChannelId}> on this server.`);
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

// --- LOGIN ---
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[Error] DISCORD_TOKEN is missing in environment variables.');
} else {
  client.login(token).catch(err => {
    console.error('[Error] Failed to login to Discord:', err.message);
  });
}
