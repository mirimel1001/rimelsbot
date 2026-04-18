const { PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: "winningrate",
  aliases: ["wr"],
  description: "Sets the win rate for a specific role in a game.",
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

    // 3. Load and Update winning_rates.json
    let winData = { defaults: {}, guilds: {} };
    const filePath = './winning_rates.json';

    try {
      if (fs.existsSync(filePath)) {
        winData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.error("Error reading winning_rates.json:", err);
    }

    // Initialize structures
    if (!winData.guilds[message.guild.id]) winData.guilds[message.guild.id] = {};
    if (!winData.guilds[message.guild.id][gameName]) winData.guilds[message.guild.id][gameName] = {};

    // Save
    winData.guilds[message.guild.id][gameName][roleId] = percentage;

    try {
      fs.writeFileSync(filePath, JSON.stringify(winData, null, 2));
      return message.reply(`✅ Success! Members with the **${role.name}** role now have a **${percentage}%** win rate in **${gameName}**.`);
    } catch (err) {
      console.error("Error writing winning_rates.json:", err);
      return message.reply("❌ Failed to save the winning rate settings.");
    }
  }
};
