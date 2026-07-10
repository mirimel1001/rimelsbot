const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
  name: "serverlist",
  aliases: ["sl"],
  description: "Display a list of servers the bot is in with search capability (Owner Only).",
  usage: "serverlist",
  ownerOnly: true,
  run: async (client, message, args, prefix, config) => {
    // 1. OWNER-ONLY SECURITY CHECK
    if (!client.owners || !client.owners.has(message.author.id)) {
      return message.reply("❌ This command is restricted to bot owners only.");
    }

    const loadingMsg = await message.reply("🔍 Fetching server list details, please wait...");

    try {
      // 2. FETCH ALL GUILD DATA IN PARALLEL
      const guilds = Array.from(client.guilds.cache.values());
      const guildsData = await Promise.all(guilds.map(async (guild) => {
        const owner = await guild.fetchOwner().catch(() => null);
        const ownerName = owner ? owner.user.tag : `Unknown (${guild.ownerId})`;

        // Find the first text channel where the bot has permission to create invites
        const channel = guild.channels.cache.find(c => 
          c.isTextBased() && 
          c.permissionsFor(client.user)?.has('CreateInstantInvite')
        );

        let inviteUrl = 'Private';
        if (channel) {
          try {
            const invite = await channel.createInvite({ maxAge: 86400, maxUses: 0 }).catch(() => null); // 24 hours expiry, unlimited uses
            if (invite) inviteUrl = invite.url;
          } catch (e) {
            // Invite generation failed, keep as Private
          }
        }

        return {
          name: guild.name,
          id: guild.id,
          owner: ownerName,
          invite: inviteUrl
        };
      }));

      let currentGuilds = [...guildsData];
      let pageIndex = 0;
      const pageSize = 10;
      let searchQuery = "";

      // 3. HELPER TO GENERATE MESSAGE DATA
      const generateMessageData = (data, index, query = "") => {
        const totalPages = Math.ceil(data.length / pageSize) || 1;
        const start = index * pageSize;
        const pageItems = data.slice(start, start + pageSize);

        const embed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🖥️ Server List')
          .setTimestamp()
          .setFooter({ text: `Page ${data.length === 0 ? 0 : index + 1} of ${totalPages} | ${data.length} total entries` });

        if (query) {
          embed.setDescription(`🔍 **Search Results for:** "${query}"\n*Found ${data.length} matching servers.*`);
        } else {
          embed.setDescription(`Total Servers: **${guildsData.length}**`);
        }

        if (data.length === 0) {
          embed.setDescription(`❌ **No servers found matching:** "${query}"`);
          embed.setColor('#ED4245');
        }

        pageItems.forEach((guild, idx) => {
          const globalIdx = start + idx + 1;
          const inviteText = guild.invite === 'Private' ? '*Private*' : `[Invite Link](${guild.invite})`;
          embed.addFields({
            name: `${globalIdx}. ${guild.name}`,
            value: `• **ID:** \`${guild.id}\`\n• **Owner:** \`${guild.owner}\`\n• **Invite:** ${inviteText}`,
            inline: false
          });
        });

        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('sl_prev')
            .setLabel('◀️ Previous')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index === 0 || data.length === 0),
          new ButtonBuilder()
            .setCustomId('sl_search')
            .setLabel('🔍 Search')
            .setStyle(ButtonStyle.Primary),
          new ButtonBuilder()
            .setCustomId('sl_next')
            .setLabel('Next ▶️')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(index >= totalPages - 1 || data.length === 0)
        );

        const row2 = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('sl_reset')
            .setLabel('🔄 Reset / Full List')
            .setStyle(ButtonStyle.Danger)
            .setDisabled(!query)
        );

        return { embeds: [embed], components: [row, row2] };
      };

      // Edit loading message with the initial page
      const mainMsg = await loadingMsg.edit({
        content: null,
        ...generateMessageData(currentGuilds, pageIndex, searchQuery)
      });

      const collector = mainMsg.createMessageComponentCollector({
        componentType: ComponentType.Button,
        time: 300000 // 5 minutes
      });

      collector.on('collect', async (i) => {
        if (i.user.id !== message.author.id) {
          return i.reply({ content: '❌ Only the command executor can interact with the server list.', flags: [MessageFlags.Ephemeral] });
        }

        if (i.customId === 'sl_prev') {
          pageIndex--;
          await i.update(generateMessageData(currentGuilds, pageIndex, searchQuery));
        }

        if (i.customId === 'sl_next') {
          pageIndex++;
          await i.update(generateMessageData(currentGuilds, pageIndex, searchQuery));
        }

        if (i.customId === 'sl_reset') {
          currentGuilds = [...guildsData];
          pageIndex = 0;
          searchQuery = "";
          await i.update(generateMessageData(currentGuilds, pageIndex, searchQuery));
        }

        if (i.customId === 'sl_search') {
          const modal = new ModalBuilder()
            .setCustomId('sl_search_modal')
            .setTitle('Search Servers');

          const queryInput = new TextInputBuilder()
            .setCustomId('sl_search_query')
            .setLabel('Search query (Name, ID, Owner)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter search term...')
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
          await i.showModal(modal);

          try {
            const submitted = await i.awaitModalSubmit({
              time: 60000,
              filter: mi => mi.customId === 'sl_search_modal' && mi.user.id === i.user.id,
            });

            if (submitted) {
              searchQuery = submitted.fields.getTextInputValue('sl_search_query').toLowerCase();
              currentGuilds = guildsData.filter(guild => 
                guild.name.toLowerCase().includes(searchQuery) ||
                guild.id.toLowerCase().includes(searchQuery) ||
                guild.owner.toLowerCase().includes(searchQuery)
              );
              pageIndex = 0;
              await submitted.update(generateMessageData(currentGuilds, pageIndex, searchQuery));
            }
          } catch (err) {
            // Modal timed out or closed
          }
        }
      });

      collector.on('end', () => {
        mainMsg.edit({ components: [] }).catch(() => {});
      });

    } catch (err) {
      console.error('[ServerList Command Error]', err);
      loadingMsg.edit({ content: '❌ An error occurred while generating the server list.' }).catch(() => {});
    }
  }
};
