const { EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: "updates",
  aliases: ["upd", "changelog"],
  description: "Displays the history of bot updates and feature additions.",
  usage: "updates",
  run: async (client, message, args, prefix, config) => {
    try {
      const updatesPath = path.join(__dirname, '../../updates.json');
      
      if (!fs.existsSync(updatesPath)) {
        return message.reply('📭 No update history found. `updates.json` is missing.');
      }

      const updatesData = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));

      if (!Array.isArray(updatesData) || updatesData.length === 0) {
        return message.reply('📭 The update history is currently empty.');
      }

      // We reverse to show the latest updates first
      const sortedUpdates = [...updatesData].reverse();
      
      // Limit to last 5 major updates to keep the embed clean
      const recentUpdates = sortedUpdates.slice(0, 5);

      const updateEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🚀 Rimel\'s Bot - Changelog & Updates')
        .setDescription(`View the latest improvements and features added to the bot.\n*Total updates tracked: ${updatesData.length}*`)
        .setThumbnail(client.user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: `Type ${prefix}updates for full history` });

      recentUpdates.forEach(update => {
        const items = update.items.map(item => `• ${item}`).join('\n');
        updateEmbed.addFields({
          name: `📦 v${update.version} - ${update.title} (${update.date})`,
          value: items || 'No details provided.',
          inline: false
        });
      });

      return message.reply({ embeds: [updateEmbed] });
    } catch (error) {
      console.error('Updates Command Error:', error);
      return message.reply('❌ Failed to load updates. There might be a formatting error in `updates.json`.');
    }
  }
};
