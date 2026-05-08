const { PermissionsBitField, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { parseShorthand, formatNumber } = require('../../utils/economy.js');

module.exports = {
  name: "maxbalance",
  aliases: ["maxbal", "mb"],
  category: "Economy",
  description: "Sets the maximum total currency (Cash + Bank) a member can have in this server.\n" +
               "If a user exceeds this limit, the excess will be automatically redacted every 15 minutes.\n\n" +
               "🔹 **Usage:**\n" +
               "• `{prefix}maxbal [amount]` - Set the limit (e.g., 1b, 500k, 10000000).\n" +
               "• `{prefix}maxbal false` - Disable the limit for this server.",
  usage: "maxbalance [amount | false]",
  run: async (client, message, args, prefix, config) => {
    // 1. Permission Check: Owner Only
    if (message.author.id !== message.guild.ownerId) {
      return message.reply("❌ Only the **Server Owner** can configure the Max Balance limit.");
    }

    const input = args[0]?.toLowerCase();
    if (!input) {
      // Show current limit
      const customData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../custom_guilds.json'), 'utf8'));
      const guildData = customData.guilds[message.guild.id] || {};
      let currentLimit = guildData.maxBalance;

      if (currentLimit === undefined) {
        if (message.guild.id === process.env.MAIN_GUILD_ID) {
          const defaultData = JSON.parse(fs.readFileSync(path.join(__dirname, '../../default_myserver.json'), 'utf8'));
          currentLimit = formatNumber(defaultData.maxBalance);
        } else {
          currentLimit = "Infinite (Not set)";
        }
      } else if (currentLimit === false) {
        currentLimit = "Infinite (Disabled)";
      } else {
        currentLimit = formatNumber(currentLimit);
      }

      return message.reply(`💰 **Current Max Balance:** \`${currentLimit}\``);
    }

    const customPath = path.join(__dirname, '../../custom_guilds.json');
    let customData = JSON.parse(fs.readFileSync(customPath, 'utf8'));
    if (!customData.guilds[message.guild.id]) customData.guilds[message.guild.id] = {};

    if (input === 'false' || input === 'off' || input === 'none') {
      customData.guilds[message.guild.id].maxBalance = false;
      fs.writeFileSync(customPath, JSON.stringify(customData, null, 2));
      
      // Update Cache
      const settings = client.gameSettings.get(message.guild.id) || {};
      settings.maxBalance = false;
      client.gameSettings.set(message.guild.id, settings);

      return message.reply("✅ **Max Balance limit has been disabled.** Members can now earn infinitely.");
    }

    const amount = parseShorthand(input);
    if (isNaN(amount) || amount < 0) {
      return message.reply("❌ Invalid amount! Please provide a positive number or shorthand (e.g., `10b`, `500k`).");
    }

    customData.guilds[message.guild.id].maxBalance = amount;
    fs.writeFileSync(customPath, JSON.stringify(customData, null, 2));

    // Update Cache
    const settings = client.gameSettings.get(message.guild.id) || {};
    settings.maxBalance = amount;
    client.gameSettings.set(message.guild.id, settings);

    const embed = new EmbedBuilder()
      .setColor('#2ECC71')
      .setTitle('⚖️ Max Balance Set')
      .setDescription(`The total currency limit for this server is now set to **${amount.toLocaleString()}**.\n\n` +
                      "Any amount above this limit will be automatically redacted every 15 minutes.")
      .setFooter({ text: 'This action helps maintain economy stability.' });

    return message.reply({ embeds: [embed] });
  }
};
