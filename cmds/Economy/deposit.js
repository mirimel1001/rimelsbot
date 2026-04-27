const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const { getEconomyToken } = require('../../utils/economy.js');

module.exports = {
  name: "deposit",
  aliases: ["dep"],
  description: "Deposit money into your bank.",
  usage: "deposit <amount or all>",
  run: async (client, message, args, prefix, config) => {
    const token = getEconomyToken(client, message.guild.id);

    if (!token) {
      return message.reply(`❌ **Economy is not configured for this server.**\nAn administrator must use \`${prefix}unbtoken\` to link an API key.`);
    }

    const amountInput = args[0];

    // Usage check (matches UnbelievaBoat style)
    if (!amountInput) {
      const usageEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
        .setDescription(`❌ Too few arguments given.\n\n**Usage:**\n\`deposit <amount or all>\`\n*Tip: You can use **k, m, b, t** as short forms (e.g., 10k, 1m).*`);
      return message.reply({ embeds: [usageEmbed] });
    }

    try {
      // 1. Fetch current balance to handle 'all' and validation
      const balanceRes = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
        headers: { 'Authorization': token }
      });

      const { cash } = balanceRes.data;

      // 2. Parse amount (supports k, m, b, t and 'all')
      const parseAmount = (str, currentCash) => {
        if (str.toLowerCase() === 'all') return currentCash;
        
        const multipliers = { 'k': 1e3, 'm': 1e6, 'b': 1e9, 't': 1e12 };
        const match = str.match(/^(\d+(?:\.\d+)?)([kmbt])?$/i);
        if (!match) return NaN;
        
        let val = parseFloat(match[1]);
        const mult = match[2]?.toLowerCase();
        if (mult) val *= multipliers[mult];
        return Math.floor(val);
      };

      const amount = parseAmount(amountInput, cash);

      if (isNaN(amount) || amount <= 0) {
        return message.reply("❌ **Invalid amount!** Please specify a valid number or `all`.");
      }

      if (amount > cash) {
        return message.reply(`❌ **Insufficient Funds!** You only have **TK${cash.toLocaleString()}** in your pocket.`);
      }

      // 3. Perform deposit
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, 
        { cash: -amount, bank: amount }, 
        { headers: { 'Authorization': token } }
      );

      const successEmbed = new EmbedBuilder()
        .setColor('#43b581') // UnbelievaBoat Green
        .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
        .setDescription(`✅ Deposited **TK${amount.toLocaleString()}** to your bank!`);

      message.reply({ embeds: [successEmbed] });

    } catch (err) {
      console.error('deposit error:', err.message);
      message.reply("❌ **Error!** I couldn't process the deposit. Please try again later.");
    }
  }
};
