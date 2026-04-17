require('dotenv').config();
const fs = require('fs');
const { Client, GatewayIntentBits, PermissionsBitField } = require('discord.js');
const config = require('./config.json');

// --- 1. DISCORD BOT LOGIC ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
  console.log('Bot is running on Wispbyte 24/7 🚀');
});

client.on('messageCreate', async (message) => {
  // Ignore bots and DM messages
  if (message.author.bot || !message.guild) return;

  // --- PREFIX RESOLUTION ---
  // Read custom prefixes from prefixes.json (Dynamic)
  let prefixes = {};
  try {
    const data = fs.readFileSync('./prefixes.json', 'utf8');
    prefixes = JSON.parse(data);
  } catch (err) {
    console.error('Error reading prefixes.json:', err.message);
  }

  // Get prefix for this guild, or use default from config
  const prefix = prefixes[message.guild.id] || config.prefix;

  if (!message.content.startsWith(prefix)) return;

  // Split message into command and arguments
  const args = message.content.slice(prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // --- COMMANDS ---

  // Ping Command
  if (command === 'ping') {
    return message.reply('Pong! 🏓');
  }

  // SetPrefix Command
  if (command === 'setprefix') {
    // Check for Administrator permission
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need **Administrator** permissions to change the prefix.');
    }

    const newPrefix = args[0];
    if (!newPrefix) {
      return message.reply(`❌ Please provide a new prefix. Usage: \`${prefix}setprefix <symbol>\``);
    }

    if (newPrefix.length > 5) {
      return message.reply('❌ Prefix must be less than 5 characters long.');
    }

    // Save new prefix to file
    prefixes[message.guild.id] = newPrefix;
    try {
      fs.writeFileSync('./prefixes.json', JSON.stringify(prefixes, null, 2));
      return message.reply(`✅ Success! The prefix for this server has been changed to: \`${newPrefix}\``);
    } catch (err) {
      console.error('Error saving prefixes.json:', err.message);
      return message.reply('❌ An error occurred while saving the new prefix.');
    }
  }
});

// Log in the bot
const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('[Error] DISCORD_TOKEN is missing in environment variables.');
} else {
  client.login(token).catch(err => {
    console.error('[Error] Failed to login to Discord:', err.message);
  });
}
