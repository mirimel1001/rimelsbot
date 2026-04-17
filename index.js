require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');

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

client.on('messageCreate', (message) => {
  // Ignore bots
  if (message.author.bot) return;

  // Simple ping command
  if (message.content.toLowerCase() === '!ping') {
    message.reply('Pong! 🏓');
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
