const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: "help",
  run: async (client, message, args, prefix, config) => {
    // Get all command names from the client.commands collection
    const commandNames = client.commands.map(cmd => `\`${prefix}${cmd.name}\``).join(', ');

    // Create the help embed
    const helpEmbed = new EmbedBuilder()
      .setColor('#5865F2') // Blurple
      .setTitle('📖 Bot Commands')
      .setDescription(`Here are the available commands for this server:\n\n${commandNames}`)
      .addFields(
        { name: 'Prefix', value: `The prefix for this server is \`${prefix}\``, inline: true },
        { name: 'Support', value: `Use \`${prefix}setprefix\` to change my prefix (Admins only).`, inline: true }
      )
      .setTimestamp()
      .setFooter({ 
        text: '✨ Most bot functions are made using AI.', 
        iconURL: client.user.displayAvatarURL() 
      });

    // Send the embed
    return message.reply({ embeds: [helpEmbed] });
  }
};
