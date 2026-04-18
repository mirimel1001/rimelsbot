const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

module.exports = {
  name: "invite",
  aliases: ["add", "join"],
  description: "Get the link to add this bot to your own server!",
  usage: "invite",
  run: async (client, message, args, prefix, config) => {
    const inviteLink = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`;

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🚀 Bring Rimel\'s Bot to Your Server!')
      .setDescription('Click the button below to invite the bot to your server and start playing minigames with your community!')
      .setThumbnail(client.user.displayAvatarURL())
      .setFooter({ text: 'Thank you for supporting this bot!' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel('Add Bot to Server')
        .setStyle(ButtonStyle.Link)
        .setURL(inviteLink)
        .setEmoji('➕')
    );

    return message.reply({ embeds: [embed], components: [row] });
  }
};
