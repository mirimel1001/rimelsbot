require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection, ActivityType } = require('discord.js');

// --- AUTO-INITIALIZATION ---
const initFiles = () => {
  const files = {
    'config.json': { prefix: 'r' },
    'prefixes.json': {},
    'winning_rates.json': {
      defaults: {
        "551413333765652481": 50,
        "1447847623321976964": 65,
        "1447847601201483858": 65,
        "1447847605555167314": 80
      },
      guilds: {}
    }
  };

  for (const [filename, content] of Object.entries(files)) {
    if (!fs.existsSync(filename)) {
      fs.writeFileSync(filename, JSON.stringify(content, null, 2));
      console.log(`[Init] Created missing file: ${filename}`);
    }
  }
};

initFiles();

// Dynamic Config Loading
const getConfig = () => JSON.parse(fs.readFileSync('./config.json', 'utf8'));
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
        client.commands.set(command.name.toLowerCase(), command);
        
        if (command.aliases && Array.isArray(command.aliases)) {
          command.aliases.forEach(alias => {
            client.aliases.set(alias.toLowerCase(), command.name.toLowerCase());
          });
        }
        
        console.log(`[Loader] Loaded: ${command.name}`);
      }
    }
  }
};

loadCommands(path.join(__dirname, 'cmds'));

// --- EVENTS ---
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Bot is running on Wispbyte 24/7 🚀');

  // Status Rotation
  const statuses = [
    { name: 'rimelsdiscord.vercel.app', type: ActivityType.Watching },
    { name: 'rhelp | rimelsdiscord', type: ActivityType.Watching }
  ];

  let i = 0;
  setInterval(() => {
    client.user.setPresence({
      activities: [statuses[i]],
      status: 'online',
    });
    i = (i + 1) % statuses.length;
  }, 120000); // 2 minutes

  // Initial status
  client.user.setPresence({
    activities: [statuses[0]],
    status: 'online',
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Refresh config and handle prefixes
  config = getConfig(); 
  let prefixes = {};
  try {
    prefixes = JSON.parse(fs.readFileSync('./prefixes.json', 'utf8'));
  } catch (err) {
    console.error('Error reading prefixes.json:', err.message);
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
