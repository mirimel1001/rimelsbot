const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const { getEconomyToken, parseShorthand } = require('../../../utils/economy.js');

module.exports = {
  name: "highlow",
  aliases: ["hl"],
  category: "Games",
  description: "Bet your UnbelievaBoat cash on a High/Low roll!",
  usage: "highlow [amount]",
  run: async (client, message, args, prefix, config) => {
    // 1. Validate Input
    const amount = parseShorthand(args[0]);
    if (!amount || isNaN(amount) || amount <= 0) {
      return message.reply(`❌ Usage: \`${prefix}highlow [amount]\` (or \`${prefix}hl [amount]\`)`);
    }

    let cooldownKey = null;
    let currentNow = Date.now();
    let delay = null;

    // --- COOLDOWN CHECK ---
    try {
      if (fs.existsSync('./default_game_settings.json')) {
        const defaults = JSON.parse(fs.readFileSync('./default_game_settings.json', 'utf8'));
        delay = defaults.delays?.highlow || null;
      }
      if (fs.existsSync('./server_game_settings.json')) {
        const settings = JSON.parse(fs.readFileSync('./server_game_settings.json', 'utf8'));
        const guildDelay = settings.guilds[message.guild.id]?.delays?.highlow;
        if (guildDelay) delay = guildDelay;
      }

      if (delay) {
        cooldownKey = `${message.guild.id}-highlow-${message.author.id}`;
        const lastPlay = client.cooldowns.get(cooldownKey);

        if (lastPlay && currentNow < lastPlay + delay) {
          const timeLeft = ((lastPlay + delay - currentNow) / 1000).toFixed(1);
          return message.reply(`⏳ Slow down! You can play **HighLow** again in **${timeLeft}s**.`);
        }
      }
    } catch (err) {
      console.error('Cooldown Check Error (HighLow):', err.message);
    }
    // ----------------------

    try {
      // 2. Fetch UnbelievaBoat Balance via Axios
      const token = getEconomyToken(client, message.guild.id);
      if (!token) {
        return message.reply(`⚠️ **Economy Link Required!** This server has not linked an UnbelievaBoat API token yet. Please ask an Administrator to use the \`${prefix}unbtoken\` command to get started.`);
      }

      const ubResponse = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
        headers: { 'Authorization': token }
      });
      const currentCash = ubResponse.data.cash;

      if (currentCash < amount) {
        return message.reply(`❌ You don't have enough cash! You currently have \`${currentCash}\` cash.`);
      }

      // 3. SET THE COOLDOWN NOW (Balance is verified)
      if (cooldownKey) client.cooldowns.set(cooldownKey, currentNow);

      // --- REMINDER LOGIC ---
      if (cooldownKey && delay) {
        try {
          const settingsPath = './server_game_settings.json';
          if (fs.existsSync(settingsPath)) {
            const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
            const isReminderOn = settings.guilds[message.guild.id]?.reminders?.[message.author.id]?.highlow;
            
            if (isReminderOn) {
              setTimeout(() => {
                message.channel.send(`🔔 <@${message.author.id}>, your **HighLow** cooldown has expired! You can play again now.`).catch(() => {});
              }, delay);
            }
          }
        } catch (err) {
          console.error('Reminder Logic Error:', err.message);
        }
      }
      // ----------------------

      // 4. Determine Win Rate based on Roles
      let winRate = 50;
      try {
        const defaultPath = './default_winning_rates.json';
        const serverPath = './server_winning_rates.json';

        let globalDefaults = {};
        if (fs.existsSync(defaultPath)) {
          const winRatesData = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
          globalDefaults = winRatesData.highlow || {};
        }

        let guildSettings = {};
        if (fs.existsSync(serverPath)) {
          const winData = JSON.parse(fs.readFileSync(serverPath, 'utf8'));
          guildSettings = winData.guilds[message.guild.id]?.highlow || {};
        }

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

      // 5. Start Game UI
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

      // 6. Button Collector
      const filter = (i) => i.user.id === message.author.id;
      const collector = msg.createMessageComponentCollector({ filter, time: 30000 });

      collector.on('collect', async (i) => {
        row.components.forEach(c => c.setDisabled(true));
        
        const shouldWin = Math.random() * 100 < winRate;
        let finalRoll;

        if (i.customId === 'high') {
          if (shouldWin) {
            finalRoll = Math.floor(Math.random() * (100 - firstRoll)) + firstRoll + 1;
          } else {
            finalRoll = Math.floor(Math.random() * firstRoll) + 1;
          }
        } else {
          if (shouldWin) {
            finalRoll = Math.floor(Math.random() * (firstRoll - 1)) + 1;
          } else {
            finalRoll = Math.floor(Math.random() * (101 - firstRoll)) + firstRoll;
          }
        }
        
        // Pity Win Logic: If we are supposed to win but rolled a tie
        if (finalRoll === firstRoll && shouldWin) {
          if (i.customId === 'high') finalRoll = firstRoll + 1;
          else finalRoll = firstRoll - 1;
        }

        // Strictly Capping (No more 101s or 0s)
        if (finalRoll > 100) finalRoll = 100;
        if (finalRoll < 1) finalRoll = 1;

        const isActualWin = (i.customId === 'high' && finalRoll > firstRoll) || (i.customId === 'low' && finalRoll < firstRoll);
        const isDraw = finalRoll === firstRoll;

        let resultEmbed = new EmbedBuilder()
          .setDescription(`First: **${firstRoll}** | Second: **${finalRoll}**\nChance: **${winRate}%**`);

        if (isDraw) {
          resultEmbed.setTitle('🤝 It\'s a Draw!')
            .setColor('#95A5A6')
            .addFields({ name: 'Result', value: 'No money was gained or lost.', inline: true });
        } else if (isActualWin) {
          resultEmbed.setTitle('🎉 You Won!')
            .setColor('#2ECC71');
        } else {
          resultEmbed.setTitle('💀 You Lost!')
            .setColor('#E74C3C');
        }

        // Update Balance via Axios
        if (!isDraw) {
          const updateAmount = isActualWin ? amount : -amount;
          try {
            await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
              cash: updateAmount
            }, {
              headers: { 'Authorization': getEconomyToken(client, message.guild.id) }
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
