const fs = require('fs');
const { PermissionsBitField } = require('discord.js');

module.exports = {
  name: "setprefix",
  category: "Administrative",
  adminOnly: true,
  description: "Change the bot's command prefix for your server.",
  usage: "setprefix [new_symbol]",
  run: async (client, message, args, prefix, config) => {
    // Check for Administrator permission
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need **Administrator** permissions to change the prefix.');
    }

    const newPrefix = args[0];
    if (!newPrefix) {
      return message.reply(`❌ Please provide a new prefix. Usage: \`${prefix}setprefix [symbol]\``);
    }

    if (newPrefix.length > 5) {
      return message.reply('❌ Prefix must be less than 5 characters long.');
    }

    try {
      const prefixes = JSON.parse(fs.readFileSync('./server_prefixes.json', 'utf8'));
      prefixes[message.guild.id] = newPrefix;
      fs.writeFileSync('./server_prefixes.json', JSON.stringify(prefixes, null, 2));

      return message.reply(`✅ Prefix updated! The new prefix for this server is \`${newPrefix}\``);
    } catch (err) {
      console.error('Error updating server_prefixes.json:', err.message);
      return message.reply(`❌ Failed to save the new prefix.`);
    }
  }
};
