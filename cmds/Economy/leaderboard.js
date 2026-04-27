const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const axios = require('axios');
const { getEconomyToken } = require('../../utils/economy.js');

module.exports = {
  name: "leaderboard",
  aliases: ["lb"],
  description: "View the server's economy leaderboard.",
  usage: "leaderboard [page] [-cash | -bank | -total]",
  run: async (client, message, args, prefix, config) => {
    const token = getEconomyToken(client, message.guild.id);

    if (!token) {
      return message.reply(`❌ **Economy is not configured for this server.**\nAn administrator must use \`${prefix}unbtoken\` to link an API key.`);
    }

    let sort = 'total';
    let page = 1;
    let invalidArg = null;

    // Parse arguments with UnbelievaBoat-style validation
    for (const arg of args) {
      if (arg.startsWith('-')) {
        const lowerArg = arg.toLowerCase();
        if (lowerArg === '-cash') sort = 'cash';
        else if (lowerArg === '-bank') sort = 'bank';
        else if (lowerArg === '-total') sort = 'total';
        else {
          invalidArg = arg;
          break;
        }
      } else if (!isNaN(arg)) {
        page = parseInt(arg);
      }
    }

    if (invalidArg) {
      const usageEmbed = new EmbedBuilder()
        .setColor('#f04747')
        .setDescription(`❌ Invalid \`[-cash | -bank | -total]\` argument given.\n\n**Usage:**\n\`leaderboard [page] [-cash | -bank | -total]\``);
      return message.reply({ embeds: [usageEmbed] });
    }

    if (page < 1) page = 1;

    const limit = 10;
    const sortLabels = {
      'cash': 'Cash Balance',
      'bank': 'Bank Balance',
      'total': 'Total Balance'
    };

    const fetchLeaderboard = async (p) => {
      try {
        const response = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users`, {
          params: { sort, limit, page: p, _t: Date.now() },
          headers: { 'Authorization': token }
        });
        return Array.isArray(response.data) ? response.data : (response.data.users || []);
      } catch (err) {
        console.error('fetchLeaderboard error:', err.message);
        return null;
      }
    };

    const createEmbed = (users, p) => {
      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle(`Leaderboard - ${message.guild.name}`)
        .setDescription(`Ranking by **${sortLabels[sort]}**\nPage **${p}**`);

      let description = "";
      users.forEach((userData, index) => {
        const rank = (p - 1) * limit + index + 1;
        const amount = (userData[sort] || 0).toLocaleString();
        
        // UnbelievaBoat style formatting
        description += `**${rank}.** <@${userData.user_id}> • 💰 \`${amount}\`\n`;
      });

      embed.addFields({ name: '\u200B', value: description || 'No users found.' });
      return embed;
    };

    const createButtons = (p, usersLength) => {
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('lb_prev')
          .setLabel('Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(p <= 1),
        new ButtonBuilder()
          .setCustomId('lb_next')
          .setLabel('Next')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(usersLength < limit)
      );
    };

    const initialUsers = await fetchLeaderboard(page);
    if (!initialUsers) return message.reply("❌ **Error!** I couldn't fetch the leaderboard. Please ensure the API token is valid.");
    if (initialUsers.length === 0) {
      return message.reply(`❌ **No data found!** There are no users on page **${page}** for this category.`);
    }

    const lbMsg = await message.reply({ 
      embeds: [createEmbed(initialUsers, page)], 
      components: [createButtons(page, initialUsers.length)] 
    });

    const collector = lbMsg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 60000
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id) {
        return i.reply({ content: '❌ Only the person who used the command can navigate pages.', ephemeral: true });
      }

      if (i.customId === 'lb_prev') page--;
      else if (i.customId === 'lb_next') page++;

      await i.deferUpdate();
      const newUsers = await fetchLeaderboard(page);
      if (newUsers && newUsers.length > 0) {
        await lbMsg.edit({ 
          embeds: [createEmbed(newUsers, page)], 
          components: [createButtons(page, newUsers.length)] 
        });
      }
    });

    collector.on('end', () => {
      lbMsg.edit({ components: [] }).catch(() => null);
    });
  }
};
