const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ComponentType } = require('discord.js');

module.exports = {
  name: "help",
  description: "Interactive command directory with category selection.",
  usage: "help",
  run: async (client, message, args, prefix, config) => {
    // 1. GROUP COMMANDS BY CATEGORY
    const categories = {};
    client.commands.forEach(cmd => {
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
        embed.addFields({
          name: `🔹 ${cmd.name.toUpperCase()}${aliasText}`,
          value: `${cmd.description || 'No description.'}\n**Usage:** ${usage}`
        });
      });

      embeds[cat] = embed;
    });

    // 3. INITIAL EMBED (General or first category)
    const defaultCat = categories['General'] ? 'General' : categoryNames[0];
    const initialEmbed = embeds[defaultCat];

    // 4. SELECT MENU
    const menuOptions = categoryNames.map(cat => ({
      label: cat,
      description: `View ${categories[cat].length} commands in ${cat}`,
      value: cat,
      emoji: cat === 'General' ? '🛡️' : (cat === 'Minigames' ? '🎮' : '🐺') 
    }));

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('help_select')
        .setPlaceholder('Select a category...')
        .addOptions(menuOptions)
    );

    const helpMsg = await message.reply({ embeds: [initialEmbed], components: [row] });

    // 5. COLLECTOR
    const collector = helpMsg.createMessageComponentCollector({
      componentType: ComponentType.StringSelect,
      time: 60000 // 1 minute
    });

    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id) {
        return i.reply({ content: '❌ You did not trigger this command.', ephemeral: true });
      }

      const selected = i.values[0];
      await i.update({ embeds: [embeds[selected]] });
    });

    collector.on('end', () => {
      const disabledRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder(row.components[0].data).setDisabled(true)
      );
      helpMsg.edit({ components: [disabledRow] }).catch(() => {});
    });
  }
};
