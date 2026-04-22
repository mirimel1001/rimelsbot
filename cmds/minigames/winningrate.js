const { PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: "winningrate",
  aliases: ["wr"],
  category: "Administrative",
  adminOnly: true,
  description: "Sets the win rate for a specific role in a game.\n\n" +
                "🔹 **Variables:**\n" +
                "• **[game name]** - The name of the game (e.g., highlow).\n" +
                "• **[@role/ID]** - Mention the role or paste the Role ID.\n" +
                "• **[percentage%]** - Win chance from 0 to 100.",
  usage: "winningrate [game name] [@role/ID] [percentage%]",
  run: async (client, message, args, prefix, config) => {
    // 1. Permission Check
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
      return message.reply("❌ You need **Manage Roles** permissions to use this command.");
    }

    // 2. Validate Args
    const gameName = args[0]?.toLowerCase();
    const roleInput = args[1];
    const percentInput = args[2];

    if (!gameName || !roleInput || !percentInput) {
      return message.reply(`❌ Usage: \`${prefix}winningrate [game] [@role/ID] [percentage%]\`\nExample: \`${prefix}wr highlow @Weak 60%\``);
    }

    // Parse Percentage
    const percentage = parseInt(percentInput.replace('%', ''));
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      return message.reply("❌ Invalid percentage. Please provide a number between 0 and 100.");
    }

    // Resolve Role ID
    let roleId = roleInput.replace(/[<@&>]/g, '');
    const role = message.guild.roles.cache.get(roleId);
    if (!role) {
      return message.reply("❌ Could not find that role. Make sure you mention it or provide a valid ID.");
    }

    // 3. Load and Update server_winning_rates.json
    let data = { guilds: {} };
    const filePath = './server_winning_rates.json';

    try {
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading server_winning_rates.json:', err.message);
      return message.reply('❌ Could not load winning rate settings.');
    }

    // Initialize structures
    if (!data.guilds[message.guild.id]) data.guilds[message.guild.id] = {};
    if (!data.guilds[message.guild.id][gameName]) data.guilds[message.guild.id][gameName] = {};

    // Save
    data.guilds[message.guild.id][gameName][role.id] = percentage;

    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      
      // Update Cache: Note that winning rates are stored as part of the guild's settings in memory
      const currentSettings = client.gameSettings.get(message.guild.id) || {};
      if (!currentSettings.winningRates) currentSettings.winningRates = {}; 
      currentSettings.winningRates[gameName] = currentSettings.winningRates[gameName] || {};
      currentSettings.winningRates[gameName][role.id] = percentage;
      client.gameSettings.set(message.guild.id, currentSettings);

      return message.reply(`✅ Success! Winning rate for **${gameName}** (Role: ${role.name}) is now **${percentage}%**.`);
    } catch (err) {
      console.error('Error writing server_winning_rates.json:', err.message);
      return message.reply('❌ Could not save winning rate settings.');
    }
  }
};
