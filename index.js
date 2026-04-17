require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Collection } = require('discord.js');
const config = require('./config.json');

// --- 1. BOT INITIALIZATION ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Setup Commands Collection
client.commands = new Collection();

// --- 2. COMMAND LOADER ---
const cmdsPath = path.join(__dirname, 'cmds');
const commandFiles = fs.readdirSync(cmdsPath).filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const filePath = path.join(cmdsPath, file);
  const command = require(filePath);

  if ('name' in command && 'run' in command) {
    client.commands.set(command.name, command);
    console.log(`[Loader] Loaded command: ${command.name}`);
  } else {
    console.warn(`[Loader] The command at ${filePath} is missing a required "name" or "run" property.`);
  }
}

// --- 3. EVENTS ---
client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Bot is running on Wispbyte 24/7 🚀');
});

client.on('messageCreate', async (message) => {
  // Ignore bots and DM messages
  if (message.author.bot || !message.guild) return;

  // --- PREFIX RESOLUTION ---
  let prefixes = {};
  try {
    const data = fs.readFileSync('./prefixes.json', 'utf8');
    prefixes = JSON.parse(data);
  } catch (err) {
    console.error('Error reading prefixes.json:', err.message);
  }

  const prefix = prefixes[message.guild.id] || config.prefix;

  // Case-insensitive prefix check
  if (!message.content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  // Split message into command and arguments
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();

  // --- COMMAND EXECUTION ---
  const command = client.commands.get(commandName);

  if (!command) return;

  try {
    await command.run(client, message, args, prefix, config);
  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    message.reply('❌ There was an error trying to execute that command!');
  }
});

// --- 4. LOGIN ---
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[Error] DISCORD_TOKEN is missing in environment variables.');
} else {
  client.login(token).catch(err => {
    console.error('[Error] Failed to login to Discord:', err.message);
  });
}
