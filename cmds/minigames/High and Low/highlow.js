const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

module.exports = {
  name: "highlow",
  aliases: ["hl"],
  description: "Bet your UnbelievaBoat cash on a High/Low roll!",
  usage: "highlow [amount]",
  run: async (client, message, args, prefix, config) => {
    // 1. Validate Input
    const amount = parseInt(args[0]);
    if (!amount || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${prefix}highlow [amount]\` (or \`${prefix}hl [amount]\`)`);
    }

    try {
      // 2. Fetch UnbelievaBoat Balance via Axios
      const ubResponse = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
        headers: { 'Authorization': process.env.UNB_TOKEN }
      });
      const currentCash = ubResponse.data.cash;

      if (currentCash < amount) {
        return message.reply(`❌ You don't have enough cash! You currently have \`${currentCash}\` cash.`);
      }

      // 3. Determine Win Rate based on Roles
      let winRate = 50;
      try {
        const winData = JSON.parse(fs.readFileSync('./winning_rates.json', 'utf8'));
        const guildSettings = winData.guilds[message.guild.id]?.highlow || {};
        const globalDefaults = winData.defaults || {};
        const activeChances = { ...globalDefaults, ...guildSettings };

        const memberRoles = message.member.roles.cache.map(r => r.id);
        const applicableRates = memberRoles
          .filter(id => activeChances[id])
          .map(id => activeChances[id]);

        if (applicableRates.length > 0) {
          winRate = Math.max(...applicableRates);
        }
      } catch (err) {
        console.error("Error calculating win rate:", err);
      }

      // 4. Start Game UI
      const firstRoll = Math.floor(Math.random() * 100) + 1;
      
      const gameEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎲 High or Lower?')
        .setDescription(`I rolled: **${firstRoll}**\n\nWill the next be **Higher** or **Lower**?\n*(Your win chance: **${winRate}%**)*`)
        .addFields({ name: 'Your Bet', value: `💰 ${amount} Cash`, inline: true })
        .setFooter({ text: 'You have 30 seconds to choose!' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('high').setLabel('Higher').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('low').setLabel('Lower').setStyle(ButtonStyle.Danger)
      );

      const msg = await message.reply({ embeds: [gameEmbed], components: [row] });

      // 5. Button Collector
      const filter = (i) => i.user.id === message.author.id;
      const collector = msg.createMessageComponentCollector({ filter, time: 30000 });

      collector.on('collect', async (i) => {
        row.components.forEach(c => c.setDisabled(true));
        
        const shouldWin = Math.random() * 100 < winRate;
        let finalRoll;

        if (i.customId === 'high') {
          if (shouldWin) {
            finalRoll = Math.floor(Math.random() * (100 - firstRoll)) + firstRoll + 1;
            if (finalRoll > 100) finalRoll = 100;
          } else {
            finalRoll = Math.floor(Math.random() * firstRoll) + 1;
          }
        } else {
          if (shouldWin) {
            finalRoll = Math.floor(Math.random() * (firstRoll - 1)) + 1;
          } else {
            finalRoll = Math.floor(Math.random() * (101 - firstRoll)) + firstRoll;
            if (finalRoll > 100) finalRoll = 100;
          }
        }
        
        if (finalRoll === firstRoll && shouldWin) finalRoll++;

        const isActualWin = (i.customId === 'high' && finalRoll > firstRoll) || (i.customId === 'low' && finalRoll < firstRoll);

        let resultEmbed = new EmbedBuilder()
          .setTitle(isActualWin ? '🎉 You Won!' : '💀 You Lost!')
          .setColor(isActualWin ? '#2ECC71' : '#E74C3C')
          .setDescription(`First: **${firstRoll}** | Second: **${finalRoll}**\nChance: **${winRate}%**`);

        // Update Balance via Axios
        const updateAmount = isActualWin ? amount : -amount;
        try {
          await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
            cash: updateAmount
          }, {
            headers: { 'Authorization': process.env.UNB_TOKEN }
          });

          if (isActualWin) {
            resultEmbed.addFields({ name: 'Winnings', value: `+${amount} Cash Added!`, inline: true });
          } else {
            resultEmbed.addFields({ name: 'Losses', value: `-${amount} Cash Removed.`, inline: true });
          }
        } catch (apiErr) {
          console.error('UB API Patch Error:', apiErr.response?.data || apiErr.message);
          resultEmbed.addFields({ name: '⚠️ Error', value: `Game finished, but could not update your UnbelievaBoat balance automatically.`, inline: false });
        }

        await i.update({ embeds: [resultEmbed], components: [row] });
        collector.stop();
      });

      collector.on('end', c => { if (c.size === 0) msg.edit({ components: [] }).catch(() => {}); });

    } catch (error) {
      console.error('HighLow Error:', error.response?.data || error.message);
      return message.reply('❌ System Error: Check logs or check if the UnbelievaBoat token is correct in your .env file!');
    }
  }
};
