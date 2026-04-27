const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const { getEconomyToken, parseShorthand } = require('../../../utils/economy.js');

module.exports = {
  name: "bet",
  aliases: ["b"],
  category: "Games",
  description: "Challenge another player to a 50/50 bet!",
  usage: "bet [username/@mention] [amount]",
  run: async (client, message, args, prefix, config) => {
    // 1. Validate Input
    const target = message.mentions.members.first() || 
                   message.guild.members.cache.find(m => m.user.username.toLowerCase() === args[0]?.toLowerCase()) ||
                   message.guild.members.cache.get(args[0]);

    const amount = parseShorthand(args[1]);

    if (!target || target.id === message.author.id) {
      return message.reply(`❌ Usage: \`${prefix}bet [@mention/username] [amount]\`. You cannot bet against yourself!`);
    }

    if (!amount || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Please specify a valid amount to bet.`);
    }

    // --- COOLDOWN CHECK ---
    let cooldownKey = `${message.guild.id}-bet-${message.author.id}`;
    let currentNow = Date.now();
    try {
      let delay = 30000; // Default 30s
      if (fs.existsSync('./default_game_settings.json')) {
        const defaults = JSON.parse(fs.readFileSync('./default_game_settings.json', 'utf8'));
        if (defaults.delays?.bet) delay = defaults.delays.bet;
      }
      if (fs.existsSync('./server_game_settings.json')) {
        const settings = JSON.parse(fs.readFileSync('./server_game_settings.json', 'utf8'));
        const guildDelay = settings.guilds[message.guild.id]?.delays?.bet;
        if (guildDelay) delay = guildDelay;
      }

      const lastPlay = client.cooldowns.get(cooldownKey);
      if (lastPlay && currentNow < lastPlay + delay) {
        const timeLeft = ((lastPlay + delay - currentNow) / 1000).toFixed(1);
        return message.reply(`⏳ Slow down! You can bet again in **${timeLeft}s**.`);
      }
    } catch (err) {
      console.error('Cooldown Check Error (Bet):', err.message);
    }
    // ----------------------

    try {
      const token = getEconomyToken(client, message.guild.id);
      if (!token) {
        return message.reply(`⚠️ **Economy Link Required!** This server has not linked an UnbelievaBoat API token yet. Please ask an Administrator to use the \`${prefix}unbtoken\` command to get started.`);
      }

      // 2. Check Initiator's Balance
      const initiatorUB = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
        headers: { 'Authorization': token }
      }).catch(() => null);

      if (!initiatorUB || initiatorUB.data.cash < amount) {
        return message.reply(`❌ You don't have enough cash! You need \`${amount}\` cash.`);
      }

      // 3. Check Target's Balance
      const targetUB = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${target.id}`, {
        headers: { 'Authorization': token }
      }).catch(() => null);

      if (!targetUB) {
        return message.reply(`❌ Could not fetch <@${target.id}>'s balance. They might not have an economy profile.`);
      }

      if (targetUB.data.cash < amount) {
        return message.reply(`❌ <@${target.id}> doesn't have enough cash for this bet!`);
      }

      // 4. Send Challenge
      const challengeEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🤝 Bet Challenge!')
        .setDescription(`<@${message.author.id}> has challenged <@${target.id}> to a bet of **${amount}** cash!\n\nBoth players must have the amount to participate. The winner takes it all!`)
        .setFooter({ text: `${target.user.username}, do you accept? (60s to respond)` });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('accept_bet').setLabel('Accept').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('decline_bet').setLabel('Decline').setStyle(ButtonStyle.Danger)
      );

      const challengeMsg = await message.reply({ content: `<@${target.id}>`, embeds: [challengeEmbed], components: [row] });

      const filter = (i) => i.user.id === target.id;
      const collector = challengeMsg.createMessageComponentCollector({ filter, time: 60000 });

      collector.on('collect', async (i) => {
        if (i.customId === 'decline_bet') {
          await i.update({ content: `❌ <@${target.id}> declined the bet.`, embeds: [], components: [] });
          return collector.stop('declined');
        }

        if (i.customId === 'accept_bet') {
          await i.deferUpdate();

          // 5. Final Balance Re-check
          const iUB = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
            headers: { 'Authorization': token }
          }).catch(() => null);
          const tUB = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${target.id}`, {
            headers: { 'Authorization': token }
          }).catch(() => null);

          if (!iUB || iUB.data.cash < amount || !tUB || tUB.data.cash < amount) {
            return i.editReply({ content: `❌ One of the players no longer has enough cash! Bet cancelled.`, embeds: [], components: [] });
          }

          // 6. Resolve Bet
          const winner = Math.random() < 0.5 ? message.author : target.user;
          const loser = winner.id === message.author.id ? target.user : message.author;

          // Update Balances
          try {
            // Deduct from loser
            await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${loser.id}`, {
              cash: -amount
            }, { headers: { 'Authorization': token } });

            // Add to winner
            await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${winner.id}`, {
              cash: amount
            }, { headers: { 'Authorization': token } });

            const resultEmbed = new EmbedBuilder()
              .setColor('#F1C40F')
              .setTitle('🎲 Bet Result!')
              .setDescription(`The dice have rolled...\n\n🏆 **Winner:** <@${winner.id}>\n💀 **Loser:** <@${loser.id}>\n\n**${amount}** cash has been transferred!`)
              .setTimestamp();

            await i.editReply({ content: '🎉 The bet is settled!', embeds: [resultEmbed], components: [] });
            
            // Set cooldown after successful game
            client.cooldowns.set(cooldownKey, Date.now());
            
          } catch (err) {
            console.error('Bet API Error:', err.response?.data || err.message);
            await i.editReply({ content: `❌ An error occurred while updating balances. Please check if the bot has enough permissions or if the UNB token is valid.`, embeds: [], components: [] });
          }
          collector.stop('accepted');
        }
      });

      collector.on('end', (collected, reason) => {
        if (reason === 'time') {
          challengeMsg.edit({ content: `⏰ Challenge expired. <@${target.id}> didn't respond in time.`, embeds: [], components: [] }).catch(() => {});
        }
      });

    } catch (error) {
      console.error('Bet Command Error:', error.response?.data || error.message);
      return message.reply('❌ System Error: Could not process the bet challenge.');
    }
  }
};
