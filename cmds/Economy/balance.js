const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { getEconomyToken } = require('../../utils/economy.js');

module.exports = {
  name: "balance",
  aliases: ["bal"],
  description: "Check your or another user's UnbelievaBoat balance.",
  usage: "balance [user]",
  run: async (client, message, args, prefix, config) => {
    const target = message.mentions.users.first() || 
                   client.users.cache.get(args[0]) || 
                   (args[0] ? await client.users.fetch(args[0]).catch(() => null) : null) || 
                   message.author;

    const token = getEconomyToken(client, message.guild.id);

    if (!token) {
      return message.reply(`❌ **Economy is not configured for this server.**\nAn administrator must use \`${prefix}unbtoken\` to link an API key.`);
    }

    try {
      const response = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${target.id}`, {
        params: { _t: Date.now() },
        headers: { 'Authorization': token }
      });

      const { cash, bank, total, rank } = response.data;

      const getOrdinal = (n) => {
        const s = ["th", "st", "nd", "rd"];
        const v = n % 100;
        return n + (s[(v - 20) % 10] || s[v] || s[0]);
      };

      const embed = new EmbedBuilder()
        .setColor('#2ECC71');

      let description = "";
      if (rank) {
        description += `🏆 **Leaderboard Rank:** \`${getOrdinal(rank)}\` <@${target.id}>\n`;
      } else {
        description += `💰 **Economy Balance for** <@${target.id}>\n`;
      }
      
      embed.setDescription(description);
      
      embed.addFields(
        { name: '💵 Cash', value: `\`${cash.toLocaleString()}\``, inline: true },
        { name: '🏦 Bank', value: `\`${bank.toLocaleString()}\``, inline: true },
        { name: '📊 Total', value: `\`${total.toLocaleString()}\``, inline: true }
      );

      message.reply({ embeds: [embed] });
    } catch (err) {
      if (err.response && err.response.status === 404) {
        return message.reply(`❌ **User Not Found!** <@${target.id}> does not have an economy profile in this server yet.`);
      }
      console.error('balance error:', err.message);
      message.reply("❌ **Error!** I couldn't fetch the balance. Please ensure the API token is valid.");
    }
  }
};
