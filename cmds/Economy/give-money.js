const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { getEconomyToken, parseShorthand } = require('../../utils/economy.js');

module.exports = {
  name: "give-money",
  aliases: ["give", "pay"],
  description: "Give some of your cash to another member.",
  usage: "give-money <member> <amount or all>",
  run: async (client, message, args, prefix, config) => {
    const token = getEconomyToken(client, message.guild.id);
    if (!token) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription(`❌ **Economy not configured!** Admin must use \`${prefix}unbtoken\`.`);
      return message.reply({ embeds: [errorEmbed] });
    }

    const target = message.mentions.members.first() || 
                   message.guild.members.cache.get(args[0]) ||
                   message.guild.members.cache.find(m => m.user.username.toLowerCase() === args[0]?.toLowerCase());

    const inputAmount = args[1]?.toLowerCase();

    // 1. Check for too few arguments
    if (!target || !inputAmount) {
      const usageEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription(`❌ Too few arguments given.\n\n**Usage:**\n\`give-money <member> <amount or all>\``);
      return message.reply({ embeds: [usageEmbed] });
    }

    // 2. Prevent giving to self or bots
    if (target.id === message.author.id) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription(`❌ You cannot give money to yourself!`);
      return message.reply({ embeds: [errorEmbed] });
    }

    if (target.user.bot) {
      const errorEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription(`❌ You cannot give money to a bot!`);
      return message.reply({ embeds: [errorEmbed] });
    }

    try {
      // 3. Fetch sender's balance
      const res = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
        headers: { 'Authorization': token }
      });
      const { cash } = res.data;

      // 4. Parse amount
      const amount = (inputAmount === 'all' || inputAmount === 'max') ? cash : parseShorthand(inputAmount);

      if (isNaN(amount) || amount <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#f04747')
          .setDescription(`❌ Invalid \`<amount or all>\` argument given.\n\n**Usage:**\n\`give-money <member> <amount or all>\``);
        return message.reply({ embeds: [errorEmbed] });
      }

      // 5. Check if sender has enough money
      if (cash <= 0) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#f04747')
          .setDescription(`❌ You don't have any money to give.`);
        return message.reply({ embeds: [errorEmbed] });
      }

      if (amount > cash) {
        const errorEmbed = new EmbedBuilder()
          .setColor('#f04747')
          .setDescription(`❌ You don't have enough money to give that much.`);
        return message.reply({ embeds: [errorEmbed] });
      }

      // 6. Execute Transfer (Two API calls)
      // Deduct from sender
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, 
        { cash: -amount }, 
        { headers: { 'Authorization': token } }
      );

      // Add to receiver
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${target.id}`, 
        { cash: amount }, 
        { headers: { 'Authorization': token } }
      );

      // 7. Success Message
      const successEmbed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setDescription(`✅ <@${target.id}> has received your **TK${amount.toLocaleString()}**`);

      message.reply({ embeds: [successEmbed] });

    } catch (err) {
      console.error('give-money error:', err.response?.data || err.message);
      const errorEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription("❌ **Error processing the transfer.**");
      message.reply({ embeds: [errorEmbed] });
    }
  }
};
