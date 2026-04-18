const { PermissionsBitField } = require('discord.js');
const fs = require('fs');

module.exports = {
  name: "delay",
  aliases: ["rdelay", "dl"],
  description: "Sets a cooldown delay for a specific minigame.",
  usage: "delay [game name] [time]",
  run: async (client, message, args, prefix, config) => {
    // 1. Permission Check
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("❌ You need **Manage Server** permissions to use this command.");
    }

    // 2. Validate Args
    const gameName = args[0]?.toLowerCase();
    const timeInput = args[1];

    if (!gameName || !timeInput) {
      return message.reply(`❌ Usage: \`${prefix}delay [game name] [time]\` (Example: \`${prefix}rdelay highlow 10s\`)`);
    }

    // 3. Parse Time
    const durationMs = parseDuration(timeInput);
    if (durationMs === null) {
      return message.reply("❌ Invalid time format! Use `s` (seconds), `m` (minutes), `h` (hours), `d` (days), or `mo` (months).\nExample: `10s`, `5m`, `2h`.");
    }

    // 4. Load and Update server_game_settings.json
    let settingsData = { guilds: {} };
    const filePath = './server_game_settings.json';

    try {
      if (fs.existsSync(filePath)) {
        settingsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.error("Error reading server_game_settings.json:", err);
    }

    // Initialize structures
    if (!settingsData.guilds[message.guild.id]) settingsData.guilds[message.guild.id] = {};
    if (!settingsData.guilds[message.guild.id].delays) settingsData.guilds[message.guild.id].delays = {};
    
    // Save
    settingsData.guilds[message.guild.id].delays[gameName] = durationMs;

    try {
      fs.writeFileSync(filePath, JSON.stringify(settingsData, null, 2));
      return message.reply(`✅ Success! The cooldown for **${gameName}** is now set to **${timeInput}**.`);
    } catch (err) {
      console.error("Error writing game_settings.json:", err);
      return message.reply("❌ Failed to save the delay settings.");
    }
  }
};

/**
 * Parses a duration string into milliseconds.
 * Supports s, m, h, d, mo.
 */
function parseDuration(input) {
  const regex = /^(\d+)(s|m|h|d|mo)$/i;
  const match = input.match(regex);

  if (!match) return null;

  const value = parseInt(match[1]);
  const unit = match[2].toLowerCase();

  const multipliers = {
    's': 1000,
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000,
    'mo': 30 * 24 * 60 * 60 * 1000
  };

  return value * multipliers[unit];
}
