const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { getEconomyToken, parseShorthand } = require('../../utils/economy.js');

module.exports = {
  name: "withdraw",
  aliases: ["with"],
  description: "Withdraw money from your bank.",
  usage: "withdraw <amount or all>",
  run: async (client, message, args, prefix, config) => {
    const token = getEconomyToken(client, message.guild.id);
    if (!token) return message.reply(`❌ **Economy not configured!** Admin must use \`${prefix}unbtoken\`.`);

    const input = args[0]?.toLowerCase();
    if (!input) {
      const usageEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription(`❌ Too few arguments given.\n\n**Usage:**\n\`withdraw <amount or all>\`\n*Tip: You can use **k, m, b, t** as short forms (e.g., 10k, 1m).*`);
      return message.reply({ embeds: [usageEmbed] });
    }

    try {
      const res = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
        headers: { 'Authorization': token }
      });
      const { bank } = res.data;

      const amount = (input === 'all' || input === 'max') ? bank : parseShorthand(input);

      if (isNaN(amount)) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#f04747')
          .setDescription(`❌ **Invalid amount!**`);
        return message.reply({ embeds: [errorEmbed] });
      }

      if (amount <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#f04747')
          .setDescription((input === 'all' || input === 'max') ? `❌ You don't have any money in your bank to withdraw.` : `❌ **Invalid amount!**`);
        return message.reply({ embeds: [errorEmbed] });
      }

      if (amount > bank) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#f04747')
          .setDescription(`❌ You don't have enough money in your bank to withdraw that much.`);
        return message.reply({ embeds: [errorEmbed] });
      }

      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, 
        { cash: amount, bank: -amount }, 
        { headers: { 'Authorization': token } }
      );

      const successEmbed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setDescription(`✅ <@${message.author.id}>, you have withdrawn **TK${amount.toLocaleString()}** from your bank account!`);

      message.reply({ embeds: [successEmbed] });
    } catch (err) {
      console.error('withdraw error:', err.message);
      const errorEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription("❌ **Error processing withdrawal.**");
      message.reply({ embeds: [errorEmbed] });
    }
  }
};
