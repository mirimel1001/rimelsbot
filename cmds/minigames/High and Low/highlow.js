const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { Client: UNBClient } = require('unb-api');

// Initialize the UnbelievaBoat Client
const unb = new UNBClient(process.env.UNB_TOKEN);

module.exports = {
  name: "highlow",
  aliases: ["hl"],
  run: async (client, message, args, prefix, config) => {
    // 1. Validate Input
    const amount = parseInt(args[0]);
    if (!amount || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${prefix}highlow <amount>\` (or \`${prefix}hl <amount>\`)`);
    }

    try {
      // 2. Check UnbelievaBoat Balance
      const userBalance = await unb.getUserBalance(message.guild.id, message.author.id);
      const currentCash = userBalance.cash;

      if (currentCash < amount) {
        return message.reply(`❌ You don't have enough cash! You currently have \`${currentCash}\` cash.`);
      }

      // 3. Start Game Logic
      const firstRoll = Math.floor(Math.random() * 100) + 1;
      
      const gameEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎲 High or Lower?')
        .setDescription(`I rolled the number: **${firstRoll}**\n\nWill the next number be **Higher** or **Lower**?`)
        .addFields({ name: 'Your Bet', value: `💰 ${amount} Cash`, inline: true })
        .setFooter({ text: 'You have 30 seconds to choose!' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('high').setLabel('Higher').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('low').setLabel('Lower').setStyle(ButtonStyle.Danger)
      );

      const msg = await message.reply({ embeds: [gameEmbed], components: [row] });

      // 4. Create Button Collector
      const filter = (i) => i.user.id === message.author.id;
      const collector = msg.createMessageComponentCollector({ filter, time: 30000 });

      collector.on('collect', async (i) => {
        // Disable buttons immediately
        row.components.forEach(c => c.setDisabled(true));
        
        const secondRoll = Math.floor(Math.random() * 100) + 1;
        const finalRoll = secondRoll === firstRoll ? secondRoll + 1 : secondRoll;

        const isWin = (i.customId === 'high' && finalRoll > firstRoll) || (i.customId === 'low' && finalRoll < firstRoll);

        let resultEmbed = new EmbedBuilder()
          .setTitle(isWin ? '🎉 You Won!' : '💀 You Lost!')
          .setColor(isWin ? '#2ECC71' : '#E74C3C')
          .setDescription(`The first number was **${firstRoll}**.\nThe second number was **${finalRoll}**.`);

        if (isWin) {
          await unb.editUserBalance(message.guild.id, message.author.id, { cash: amount }, `Won High/Low bet of ${amount}`);
          resultEmbed.addFields({ name: 'Winnings', value: `+${amount} Cash Added to your account!`, inline: true });
        } else {
          await unb.editUserBalance(message.guild.id, message.author.id, { cash: -amount }, `Lost High/Low bet of ${amount}`);
          resultEmbed.addFields({ name: 'Losses', value: `-${amount} Cash Removed from your account.`, inline: true });
        }

        await i.update({ embeds: [resultEmbed], components: [row] });
        collector.stop();
      });

      collector.on('end', collected => {
        if (collected.size === 0) {
          msg.edit({ content: '⏰ Time out! The bet was cancelled.', components: [] }).catch(() => {});
        }
      });

    } catch (error) {
      console.error('UnbelievaBoat API Error:', error);
      return message.reply('❌ Error: Could not connect to UnbelievaBoat. Make sure you have **authorized** my token for this server!');
    }
  }
};
