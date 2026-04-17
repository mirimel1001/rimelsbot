require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const config = require('./config.json');

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
});

client.on('messageCreate', async (message) => {
  if (message.author.bot || !message.guild) return;

  // Prefix Resolution
  let prefixes = {};
  try {
    const data = fs.readFileSync('./prefixes.json', 'utf8');
    prefixes = JSON.parse(data);
  } catch (err) {
    console.error('Error reading prefixes.json:', err.message);
  }

  const prefix = prefixes[message.guild.id] || config.prefix;

  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandInput = args.shift().toLowerCase();

  // Command & Alias Resolution
  const commandName = client.commands.has(commandInput) 
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
