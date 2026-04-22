const { PermissionsBitField } = require('discord.js');
const fs = require('fs');

module.exports = {
  name: "setcash",
  aliases: ["sc", "rsc"],
  category: "Administrative",
  adminOnly: true,
  description: "Sets the range of cash rewards for a specific minigame.\n\n" +
                "🔹 **Variables:**\n" +
                "• **[game name]** - The name of the reward game (e.g., imageguess).\n" +
                "• **[Min]** - The minimum possible cash reward.\n" +
                "• **[Max]** - The maximum possible cash reward.",
  usage: "setcash [game name] [Min] [Max]",
  run: async (client, message, args, prefix, config) => {
    // 1. Permission Check
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("❌ You need **Manage Server** permissions to use this command.");
    }

    // 2. Validate Args
    const bettingGames = ['highlow', 'hl'];
    const gameName = args[0]?.toLowerCase();
    const minStr = args[1];
    const maxStr = args[2];

    if (!gameName || !minStr || !maxStr) {
      return message.reply(`❌ Usage: \`${prefix}setcash [game name] [Min] [Max]\`\nExample: \`${prefix}rsc imageguess 500 1000\``);
    }

    if (bettingGames.includes(gameName)) {
      return message.reply(`❌ **${gameName}** is a betting game! Its prizes are determined by the user's bet, so you cannot set a manual range for it.`);
    }

    const min = parseInt(minStr);
    const max = parseInt(maxStr);

    if (isNaN(min) || isNaN(max) || min < 0 || max < min) {
      return message.reply("❌ Invalid numbers. Ensure Min and Max are positive and Max is greater than or equal to Min.");
    }

    // 3. Load and Update server_prize_configs.json
    let prizeData = { guilds: {} };
    const filePath = './server_prize_configs.json';

    try {
      if (fs.existsSync(filePath)) {
        prizeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.error("Error reading server_prize_configs.json:", err);
    }

    // Initialize structures
    if (!prizeData.guilds[message.guild.id]) prizeData.guilds[message.guild.id] = {};
    
    // Save
    prizeData.guilds[message.guild.id][gameName] = { min, max };

    try {
      fs.writeFileSync(filePath, JSON.stringify(prizeData, null, 2));
      
      // Update Cache: Note that prize ranges are stored as part of the guild's settings in memory
      const currentSettings = client.gameSettings.get(message.guild.id) || {};
      if (!currentSettings.prizes) currentSettings.prizes = {};
      currentSettings.prizes[gameName] = { min, max };
      client.gameSettings.set(message.guild.id, currentSettings);

      return message.reply(`✅ Success! The cash reward for **${gameName}** in this server is now set to a range of **💰 ${min} - ${max} Cash**.`);
    } catch (err) {
      console.error("Error writing prize_configs.json:", err);
      return message.reply("❌ Failed to save the prize settings.");
    }
  }
};
