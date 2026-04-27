const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, ButtonBuilder, ButtonStyle, MessageFlags, PermissionsBitField, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');

module.exports = {
  name: "help",
  description: "Interactive command directory with category selection.",
  usage: "help",
  run: async (client, message, args, prefix, config) => {
    // 1. GROUP COMMANDS BY CATEGORY
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator) || message.guild.ownerId === message.author.id;

    const categories = {};
    client.commands.forEach(cmd => {
      // Filter Administrative Commands for non-admins
      if (cmd.adminOnly && !isAdmin) return;

      const cat = cmd.category || 'Other';
      if (!categories[cat]) categories[cat] = [];
      categories[cat].push(cmd);
    });

    const categoryNames = Object.keys(categories).sort();

    // 2. GENERATE CATEGORY EMBEDS
    const embeds = {};
    categoryNames.forEach(cat => {
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📚 Category: ${cat}`)
        .setDescription(`Listing all commands in the **${cat}** category. Current prefix: \`${prefix}\``)
        .setTimestamp()
        .setFooter({ text: '✨ Use the dropdown to switch categories.' });

      categories[cat].forEach(cmd => {
        const aliasText = cmd.aliases && cmd.aliases.length > 0 ? ` [${cmd.aliases.join(', ')}]` : '';
        const usage = cmd.usage ? `\`${prefix}${cmd.usage}\`` : `\`${prefix}${cmd.name}\``;
        
        let desc = cmd.description || 'No description.';
        if (cat === 'Game Settings') {
          desc = desc.split(/🔹 \*\*Variables:\*\*|\*\*Variables:\*\*/i)[0].trim();
        }

        embed.addFields({
          name: `🔹 ${cmd.name.toUpperCase()}${aliasText}`,
          value: `${desc}\n**Usage:** ${usage}`
        });
      });

      embeds[cat] = embed;
    });

    // 3. INITIAL EMBED (General or first category)
    let defaultCat = categories['General'] ? 'General' : categoryNames[0];
    let initialEmbed = embeds[defaultCat];
    
    // Check for direct access/search via arguments
    if (args[0]) {
      const query = args.join(' ').toLowerCase();
      const catMatch = categoryNames.find(c => c.toLowerCase() === query || c.toLowerCase().includes(query));
      
      if (catMatch) {
        initialEmbed = embeds[catMatch];
      } else {
        // Keyword Search
        const allAvailableCommands = [];
        Object.values(categories).forEach(catCmds => allAvailableCommands.push(...catCmds));
        
        const matches = allAvailableCommands.filter(cmd => 
          cmd.name.toLowerCase().includes(query) ||
          (cmd.aliases && cmd.aliases.some(a => a.toLowerCase().includes(query))) ||
          (cmd.description && cmd.description.toLowerCase().includes(query))
        );

        if (matches.length === 1) {
          const cmd = matches[0];
          const aliasText = cmd.aliases && cmd.aliases.length > 0 ? ` [${cmd.aliases.join(', ')}]` : '';
          const usage = cmd.usage ? `\`${prefix}${cmd.usage}\`` : `\`${prefix}${cmd.name}\``;
          
          initialEmbed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle(`🔍 Command: ${cmd.name.toUpperCase()}`)
            .setDescription(`${cmd.description || 'No description.'}`)
            .addFields(
              { name: 'Category', value: `📁 ${cmd.category || 'Other'}`, inline: true },
              { name: 'Usage', value: `⌨️ ${usage}`, inline: true }
            )
            .setTimestamp()
            .setFooter({ text: '✨ Use the dropdown to browse all categories.' });
          
          if (cmd.aliases && cmd.aliases.length > 0) {
            initialEmbed.addFields({ name: 'Aliases', value: `\`${cmd.aliases.join(', ')}\``, inline: true });
          }
        } else if (matches.length > 1) {
          initialEmbed = new EmbedBuilder()
            .setColor('#F1C40F')
            .setTitle(`🔍 Search Results: ${query}`)
            .setDescription(`Multiple commands matched your search:\n\n${matches.map(cmd => `• **${cmd.name.toUpperCase()}** (${cmd.category})`).join('\n')}\n\n*Type \`${prefix}help [name]\` for more details.*`)
            .setTimestamp()
            .setFooter({ text: '✨ Use the dropdown to browse all categories.' });
        } else {
          initialEmbed = new EmbedBuilder()
            .setColor('#E74C3C')
            .setTitle('❌ No Results Found')
            .setDescription(`I couldn't find any commands or categories matching **${query}**.\nShowing the default menu below.`)
            .setTimestamp()
            .setFooter({ text: '✨ Use the dropdown to browse all categories.' });
        }
      }
    }

    // 4. SELECT MENU
    const emojiMap = {
      'General': '🛡️',
      'Games': '🎮',
      'Game Settings': '⚙️',
      'Economy': '💰'
    };

    const menuOptions = categoryNames.map(cat => ({
      label: cat,
      description: `View ${categories[cat].length} commands in ${cat}`,
      value: cat,
      emoji: emojiMap[cat] || '📁'
    }));

    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_select')
        .setPlaceholder('Select a category...')
        .addOptions(menuOptions)
    );

    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Invite Bot')
        .setStyle(ButtonStyle.Link)
        .setURL(inviteLink)
        .setEmoji('➕'),
      new ButtonBuilder()
        .setCustomId('help_search')
        .setLabel('Search')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔍')
    );

    const helpMsg = await message.reply({ embeds: [initialEmbed], components: [row, row2] });

    // 5. COLLECTOR
    const collector = helpMsg.createMessageComponentCollector({
      time: 60000 // 1 minute
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id) {
        return i.reply({ content: '❌ You did not trigger this command.', flags: [MessageFlags.Ephemeral] });
      }

      if (i.isStringSelectMenu()) {
        const selected = i.values[0];
        await i.update({ embeds: [embeds[selected]] });
      } else if (i.isButton()) {
        if (i.customId === 'help_search') {
          const modal = new ModalBuilder()
            .setCustomId('help_search_modal')
            .setTitle('Search Commands');

          const searchInput = new TextInputBuilder()
            .setCustomId('search_query')
            .setLabel("What are you looking for?")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('Enter command name, alias, or keyword...')
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(searchInput));
          await i.showModal(modal);

          const submitted = await i.awaitModalSubmit({
            time: 60000,
            filter: it => it.customId === 'help_search_modal' && it.user.id === message.author.id,
          }).catch(() => null);

          if (submitted) {
            const query = submitted.fields.getTextInputValue('search_query').toLowerCase();
            let resultEmbed;
            
            const catMatch = categoryNames.find(c => c.toLowerCase() === query || c.toLowerCase().includes(query));
            if (catMatch) {
              resultEmbed = embeds[catMatch];
            } else {
              const allAvailableCommands = [];
              Object.values(categories).forEach(catCmds => allAvailableCommands.push(...catCmds));
              
              const matches = allAvailableCommands.filter(cmd => 
                cmd.name.toLowerCase().includes(query) ||
                (cmd.aliases && cmd.aliases.some(a => a.toLowerCase().includes(query))) ||
                (cmd.description && cmd.description.toLowerCase().includes(query))
              );

              if (matches.length === 1) {
                const cmd = matches[0];
                const aliasText = cmd.aliases && cmd.aliases.length > 0 ? ` [${cmd.aliases.join(', ')}]` : '';
                const usage = cmd.usage ? `\`${prefix}${cmd.usage}\`` : `\`${prefix}${cmd.name}\``;
                
                resultEmbed = new EmbedBuilder()
                  .setColor('#F1C40F')
                  .setTitle(`🔍 Command: ${cmd.name.toUpperCase()}`)
                  .setDescription(`${cmd.description || 'No description.'}`)
                  .addFields(
                    { name: 'Category', value: `📁 ${cmd.category || 'Other'}`, inline: true },
                    { name: 'Usage', value: `⌨️ ${usage}`, inline: true }
                  )
                  .setTimestamp()
                  .setFooter({ text: '✨ Use the dropdown to browse all categories.' });
                
                if (cmd.aliases && cmd.aliases.length > 0) {
                  resultEmbed.addFields({ name: 'Aliases', value: `\`${cmd.aliases.join(', ')}\``, inline: true });
                }
              } else if (matches.length > 1) {
                resultEmbed = new EmbedBuilder()
                  .setColor('#F1C40F')
                  .setTitle(`🔍 Search Results: ${query}`)
                  .setDescription(`Multiple commands matched your search:\n\n${matches.map(cmd => `• **${cmd.name.toUpperCase()}** (${cmd.category})`).join('\n')}\n\n*Type \`${prefix}help [name]\` for more details.*`)
                  .setTimestamp()
                  .setFooter({ text: '✨ Use the dropdown to browse all categories.' });
              } else {
                resultEmbed = new EmbedBuilder()
                  .setColor('#E74C3C')
                  .setTitle('❌ No Results Found')
                  .setDescription(`I couldn't find any commands or categories matching **${query}**.\nShowing the default menu below.`)
                  .setTimestamp()
                  .setFooter({ text: '✨ Use the dropdown to browse all categories.' });
              }
            }
            await submitted.update({ embeds: [resultEmbed] });
          }
        }
      }
    });

    collector.on('end', () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder(row.components[0].data).setDisabled(true)
      );
      const disabledRow2 = new ActionRowBuilder().addComponents(
        row2.components.map(comp => new ButtonBuilder(comp.data).setDisabled(true))
      );
      helpMsg.edit({ components: [disabledRow, disabledRow2] }).catch(() => {});
    });
  }
};
