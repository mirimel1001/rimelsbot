require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');

// --- AUTO-INITIALIZATION ---
const initFiles = () => {
  const files = {
    'server_config.json': { prefix: 'r' },
    'server_prefixes.json': {},
    'server_winning_rates.json': {
      defaults: {
        "551413333765652481": 50,
        "1447847623321976964": 65,
        "1447847601201483858": 65,
        "1447847605555167314": 80
      },
      guilds: {}
    },
    'server_prize_configs.json': { guilds: {} },
    'server_game_settings.json': { 
      defaults: {
        delays: {
          highlow: 40000,
          imageguess: 30000
        }
      },
      guilds: {} 
    }
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
        // --- DYNAMIC CATEGORY ASSIGNMENT ---
        const relativePath = path.relative(path.join(__dirname, 'cmds'), dir);
        if (!relativePath) {
          command.category = 'General';
        } else if (relativePath === 'minigames') {
          command.category = 'Minigames';
        } else if (relativePath.startsWith('minigames' + path.sep)) {
          // Use the folder name inside minigames as the category (e.g., 'Werewolf')
          command.category = relativePath.split(path.sep)[1];
        } else {
          command.category = relativePath;
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
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Bot is running on Wispbyte 24/7 🚀');

  const activities = [
    { name: `${config.prefix}help || Check bio for support`, type: ActivityType.Watching },
    { name: `${config.prefix}help || Servers: {servers}`, type: ActivityType.Watching }
  ];

  let i = 0;
  setInterval(() => {
    config = getConfig(); // Keep prefix fresh
    const activity = activities[i];
    const name = activity.name.replace('{servers}', client.guilds.cache.size);
    
    client.user.setPresence({
      activities: [{ name, type: activity.type }],
      status: 'online',
    });
    
    i = (i + 1) % activities.length;
  }, 60000);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Refresh config and handle prefixes
  config = getConfig(); 
  let prefixes = {};
  try {
    prefixes = JSON.parse(fs.readFileSync('./server_prefixes.json', 'utf8'));
  } catch (err) {
    console.error('Error reading server_prefixes.json:', err.message);
  }

  const prefix = prefixes[message.guild.id] || config.prefix;

  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandInput = args.shift().toLowerCase();

  const commandName = client.commands.get(commandInput) 
    ? commandInput 
    : client.aliases.get(commandInput);

  const command = client.commands.get(commandName);

  if (!command) return;

  // --- GAME CHANNEL RESTRICTION ---
  if (command.category === 'minigame') {
    try {
      if (fs.existsSync('./server_game_settings.json')) {
        const gameSettings = JSON.parse(fs.readFileSync('./server_game_settings.json', 'utf8'));
        const dedicatedChannel = gameSettings.guilds[message.guild.id]?.gameChannel;

        if (dedicatedChannel && message.channel.id !== dedicatedChannel) {
          return message.reply(`🚫 Minigames are restricted to <#${dedicatedChannel}> on this server.`);
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

// --- LOGIN ---
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[Error] DISCORD_TOKEN is missing in environment variables.');
} else {
  client.login(token).catch(err => {
    console.error('[Error] Failed to login to Discord:', err.message);
  });
}
