const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  ComponentType 
} = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: "updates",
  aliases: ["upd", "changelog"],
  description: "Displays the history of bot updates with pagination and keyword search.",
  usage: "updates [keyword]",
  run: async (client, message, args, prefix, config) => {
    try {
      const updatesPath = path.join(__dirname, '../updates.json');
      
      if (!fs.existsSync(updatesPath)) {
        return message.reply('📭 No update history found. `updates.json` is missing.');
      }

      const updatesData = JSON.parse(fs.readFileSync(updatesPath, 'utf8'));

      if (!Array.isArray(updatesData) || updatesData.length === 0) {
        return message.reply('📭 The update history is currently empty.');
      }

      let currentUpdates = [...updatesData].reverse();
      let pageIndex = 0;
      const pageSize = 2;
      let searchQuery = args.join(' ').toLowerCase();

      // --- Helper: Generate Embed & Buttons ---
      const generateMessageData = (data, index, query = "") => {
        const totalPages = Math.ceil(data.length / pageSize);
        const start = index * pageSize;
        const pageItems = data.slice(start, start + pageSize);

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🚀 Rimel\'s Bot - Changelog & Updates')
          .setThumbnail(client.user.displayAvatarURL())
          .setTimestamp();

        if (query) {
          embed.setDescription(`🔍 **Search Results for:** "${query}"\n*Found ${data.length} matching updates.*`);
        } else {
          embed.setDescription(`View the latest improvements and features added to the bot.\n*Total updates tracked: ${updatesData.length}*`);
        }

        pageItems.forEach(update => {
          const items = update.items.map(item => `• ${item}`).join('\n');
          embed.addFields({
            name: `📦 v${update.version} - ${update.title} (${update.date})`,
            value: items || 'No details provided.',
            inline: false
          });
        });

        if (data.length === 0) {
          embed.setDescription(`❌ **No results found for:** "${query}"\nTry searching for broader keywords like "werewolf" or "ui".`);
          embed.setColor('#ED4245');
        }

        embed.setFooter({ text: `Page ${data.length === 0 ? 0 : index + 1} of ${totalPages} | ${data.length} total entries` });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('prev')
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === 0 || data.length === 0),
          new ButtonBuilder()
            .setCustomId('search')
            .setLabel('🔍 Search')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('next')
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index >= totalPages - 1 || data.length === 0)
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('reset')
            .setLabel('🔄 Reset / Full List')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!query)
        );

        return { embeds: [embed], components: data.length > 0 ? [row, row2] : [row2] };
      };

      // --- Handle Initial Search Argument ---
      if (searchQuery) {
        currentUpdates = updatesData
          .map(u => ({ ...u })) // Clone to avoid mutating original data
          .filter(u => {
            const titleMatch = u.title.toLowerCase().includes(searchQuery);
            const versionMatch = u.version.toLowerCase().includes(searchQuery);
            const matchingItems = u.items.filter(item => item.toLowerCase().includes(searchQuery));
            
            // If the version or title itself matches, show everything in that update
            if (titleMatch || versionMatch) return true;
            
            // Otherwise, filter items and only keep the update if there are matches
            if (matchingItems.length > 0) {
              u.items = matchingItems;
              return true;
            }
            return false;
          }).reverse();
      } else {
        currentUpdates = [...updatesData].reverse();
      }

      const mainMsg = await message.reply(generateMessageData(currentUpdates, pageIndex, searchQuery));
      const collector = mainMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

      collector.on('collect', async (i) => {
        if (i.user.id !== message.author.id) return i.reply({ content: 'Only the command user can navigate.', ephemeral: true });

        if (i.customId === 'prev') {
          pageIndex--;
          await i.update(generateMessageData(currentUpdates, pageIndex, searchQuery));
        }

        if (i.customId === 'next') {
          pageIndex++;
          await i.update(generateMessageData(currentUpdates, pageIndex, searchQuery));
        }

        if (i.customId === 'reset') {
          currentUpdates = [...updatesData].reverse();
          pageIndex = 0;
          searchQuery = "";
          await i.update(generateMessageData(currentUpdates, pageIndex, searchQuery));
        }

        if (i.customId === 'search') {
          const modal = new ModalBuilder()
            .setCustomId('search_modal')
            .setTitle('Search Update History');

          const queryInput = new TextInputBuilder()
            .setCustomId('search_query')
            .setLabel('Keyword (e.g. Werewolf, Fix, UI)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter search terms...')
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
          await i.showModal(modal);

          // Listen for modal submission
          try {
            const submitted = await i.awaitModalSubmit({
              time: 60000,
              filter: mi => mi.customId === 'search_modal' && mi.user.id === i.user.id,
            });

            if (submitted) {
              searchQuery = submitted.fields.getTextInputValue('search_query').toLowerCase();
              currentUpdates = updatesData
                .map(u => ({ ...u }))
                .filter(u => {
                  const titleMatch = u.title.toLowerCase().includes(searchQuery);
                  const versionMatch = u.version.toLowerCase().includes(searchQuery);
                  const matchingItems = u.items.filter(item => item.toLowerCase().includes(searchQuery));
                  
                  if (titleMatch || versionMatch) return true;
                  if (matchingItems.length > 0) {
                    u.items = matchingItems;
                    return true;
                  }
                  return false;
                }).reverse();
              pageIndex = 0;
              await submitted.update(generateMessageData(currentUpdates, pageIndex, searchQuery));
            }
          } catch (err) {
            // Modal timed out or user closed it
          }
        }
      });

      collector.on('end', () => {
        mainMsg.edit({ components: [] }).catch(() => {});
      });

    } catch (error) {
      console.error('Updates Command Error:', error);
      return message.reply('❌ Failed to load updates. There might be a formatting error in `updates.json`.');
    }
  }
};
