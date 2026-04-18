const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Client: UNBClient } = require('unb-api');
const fs = require('fs');

// Initialize the UnbelievaBoat Client
const unb = new UNBClient(process.env.UNB_TOKEN);

module.exports = {
  name: "highlow",
  aliases: ["hl"],
  description: "Bet your UnbelievaBoat cash on a High/Low roll!",
  usage: "highlow <amount>",
  run: async (client, message, args, prefix, config) => {
    // 1. Validate Input
    const amount = parseInt(args[0]);
    if (!amount || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${prefix}highlow <amount>\` (or \`${prefix}hl <amount>\`)`);
    }

    try {
      // 2. Check UnbelievaBoat Balance
      const userBalance = await unb.getUserBalance(message.guild.id, message.author.id);
      if (userBalance.cash < amount) {
        return message.reply(`❌ You don't have enough cash! You currently have \`${userBalance.cash}\` cash.`);
      }

      // 3. Determine Win Rate based on Roles
      let winRate = 50; // Default base chance
      try {
        const winData = JSON.parse(fs.readFileSync('./winning_rates.json', 'utf8'));
        
        // Load role IDs and chances from both defaults and guild-specific settings
        const guildSettings = winData.guilds[message.guild.id]?.highlow || {};
        const globalDefaults = winData.defaults || {};

        // Merge them (Guild settings override defaults)
        const activeChances = { ...globalDefaults, ...guildSettings };

        // Check user's roles and pick the highest rate
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
        
        // --- WEIGHTED LOGIC ---
        const shouldWin = Math.random() * 100 < winRate;
        let finalRoll;

        if (i.customId === 'high') {
          if (shouldWin) {
            // Pick a random number HIGHER than firstRoll (up to 100)
            finalRoll = Math.floor(Math.random() * (100 - firstRoll)) + firstRoll + 1;
            if (finalRoll > 100) finalRoll = 100;
          } else {
            // Pick a random number LOWER or equal to firstRoll
            finalRoll = Math.floor(Math.random() * firstRoll) + 1;
          }
        } else { // 'low'
          if (shouldWin) {
            // Pick a random number LOWER than firstRoll
            finalRoll = Math.floor(Math.random() * (firstRoll - 1)) + 1;
          } else {
            // Pick a random number HIGHER or equal to firstRoll
            finalRoll = Math.floor(Math.random() * (101 - firstRoll)) + firstRoll;
            if (finalRoll > 100) finalRoll = 100;
          }
        }
        
        // Safety: Ensure it's not the exact same number unless it's a loss
        if (finalRoll === firstRoll && shouldWin) finalRoll++;

        const isActualWin = (i.customId === 'high' && finalRoll > firstRoll) || (i.customId === 'low' && finalRoll < firstRoll);

        let resultEmbed = new EmbedBuilder()
          .setTitle(isActualWin ? '🎉 You Won!' : '💀 You Lost!')
          .setColor(isActualWin ? '#2ECC71' : '#E74C3C')
          .setDescription(`First: **${firstRoll}** | Second: **${finalRoll}**\nChance: **${winRate}%**`);

        if (isActualWin) {
          await unb.editUserBalance(message.guild.id, message.author.id, { cash: amount }, `Won High/Low bet`);
          resultEmbed.addFields({ name: 'Winnings', value: `+${amount} Cash Added!`, inline: true });
        } else {
          await unb.editUserBalance(message.guild.id, message.author.id, { cash: -amount }, `Lost High/Low bet`);
          resultEmbed.addFields({ name: 'Losses', value: `-${amount} Cash Removed.`, inline: true });
        }

        await i.update({ embeds: [resultEmbed], components: [row] });
        collector.stop();
      });

      collector.on('end', c => { if (c.size === 0) msg.edit({ components: [] }).catch(() => {}); });

    } catch (error) {
      console.error('Bot Error:', error);
      return message.reply('❌ System Error: Check logs or authorization!');
    }
  }
};
