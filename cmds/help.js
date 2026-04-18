const { EmbedBuilder } = require('discord.js');

module.exports = {
  name: "help",
  description: "Displays a list of all available commands and their usage.",
  usage: "help",
  run: async (client, message, args, prefix, config) => {
    // Create the help embed
    const helpEmbed = new EmbedBuilder()
      .setColor('#5865F2') // Blurple
      .setTitle('📚 Command Directory')
      .setDescription(`Use the commands below to interact with the bot. Current prefix: \`${prefix}\``)
      .setTimestamp()
      .setFooter({ 
        text: '✨ Most bot functions are made using AI.', 
        iconURL: message.guild.iconURL() 
      });

    // Add fields for each command dynamically
    client.commands.forEach((cmd) => {
      const aliasText = cmd.aliases && cmd.aliases.length > 0 ? ` [${cmd.aliases.join(', ')}]` : '';
      const description = cmd.description || 'No description provided.';
      const usage = cmd.usage ? `\`${prefix}${cmd.usage}\`` : `\`${prefix}${cmd.name}\``;

      helpEmbed.addFields({
        name: `🔹 ${cmd.name.toUpperCase()}${aliasText}`,
        value: `${description}\n**Usage:** ${usage}`,
        inline: false
      });
    });

    // Send the embed
    return message.reply({ embeds: [helpEmbed] });
  }
};
