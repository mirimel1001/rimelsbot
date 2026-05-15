const { PermissionsBitField, EmbedBuilder } = require('discord.js');
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

    const Guild = require('../../models/Guild');
    const input = args[0]?.toLowerCase();
    
    if (!input) {
      // Show current limit from Cache
      const settings = client.gameSettings.get(message.guild.id) || {};
      let currentLimit = settings.maxBalance;

      if (currentLimit === undefined) {
        const mainGuildId = process.env.MAIN_GUILD_ID?.trim().replace(/^["'](.+)["']$/, '$1');
        if (message.guild.id === mainGuildId) {
          // Defaults should already be in the Cloud/Cache after migration
          currentLimit = "Not configured in Cloud";
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

    if (input === 'false' || input === 'off' || input === 'none') {
      const settings = client.gameSettings.get(message.guild.id) || {};
      settings.maxBalance = false;
      
      await Guild.findOneAndUpdate(
        { guildId: message.guild.id },
        { gameSettings: settings },
        { upsert: true }
      );
      
      client.gameSettings.set(message.guild.id, settings);
      return message.reply("✅ **Max Balance limit has been disabled.** Members can now earn infinitely.");
    }

    const amount = parseShorthand(input);
    if (isNaN(amount) || amount < 0) {
      return message.reply("❌ Invalid amount! Please provide a positive number or shorthand (e.g., `10b`, `500k`).");
    }

    const settings = client.gameSettings.get(message.guild.id) || {};
    settings.maxBalance = amount;

    await Guild.findOneAndUpdate(
      { guildId: message.guild.id },
      { gameSettings: settings },
      { upsert: true }
    );

    client.gameSettings.set(message.guild.id, settings);

    const embed = new EmbedBuilder()
      .setColor('#2ECC71')
      .setTitle('⚖️ Max Balance Set')
      .setDescription(`The total currency limit for this server is now set to **${amount.toLocaleString()}**.\n\n` +
                      "Any amount above this limit will be automatically redacted periodically.")
      .setFooter({ text: 'This action helps maintain economy stability.' });

    return message.reply({ embeds: [embed] });
  }
};
