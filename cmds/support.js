const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: "support",
  description: "Get the official links for our community Discord and website.",
  usage: "support",
  run: async (client, message, args, prefix, config) => {
    const supportEmbed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🤝 Support & Community')
      .setDescription('Join our official community for updates, support, and to meet other users! You can also check out our official website.')
      .addFields(
        { name: '🌐 Official Website', value: '[rimelsdiscord.vercel.app](https://rimelsdiscord.vercel.app)', inline: true },
        { name: '💬 Discord Server', value: '[Join the Community](https://discord.gg/mkMy3Cd)', inline: true }
      )
      .setTimestamp()
      .setFooter({ text: 'rimelsdiscord community' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Visit Website')
        .setStyle(ButtonStyle.Link)
        .setURL('https://rimelsdiscord.vercel.app'),
      new ButtonBuilder()
        .setLabel('Join Discord')
        .setStyle(ButtonStyle.Link)
        .setURL('https://discord.gg/mkMy3Cd')
    );

    return message.reply({ embeds: [supportEmbed], components: [row] });
  }
};
