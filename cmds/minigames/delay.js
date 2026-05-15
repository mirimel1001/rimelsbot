const { PermissionsBitField } = require('discord.js');

module.exports = {
  name: "delay",
  aliases: ["rdelay", "dl"],
  category: "Administrative",
  adminOnly: true,
  description: "Sets a cooldown delay for a specific minigame.\n\n" +
                "🔹 **Variables:**\n" +
                "• **[game name]** - The name of the game (e.g., highlow).\n" +
                "• **[time]** - Cooldown duration (e.g., 10s, 5m, 1h).",
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

    // 4. Update Database
    try {
      const Guild = require('../../models/Guild');
      const currentCache = client.gameSettings.get(message.guild.id) || {};
      
      if (!currentCache.delays) currentCache.delays = {};
      currentCache.delays[gameName] = durationMs;

      await Guild.findOneAndUpdate(
        { guildId: message.guild.id },
        { gameSettings: currentCache },
        { upsert: true }
      );
      
      client.gameSettings.set(message.guild.id, currentCache);
      return message.reply(`✅ Success! The cooldown for **${gameName}** is now set to **${timeInput}**.`);
    } catch (err) {
      console.error("Error updating Database:", err);
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
