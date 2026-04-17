require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

// --- 1. KEEP-ALIVE SERVER ---
const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Bot is online and stayin\' alive! 🚀');
});

app.listen(port, () => {
  console.log(`Keep-alive server listening on port ${port}`);
});

// --- 2. DISCORD BOT LOGIC ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}!`);
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
