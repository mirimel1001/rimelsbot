const fs = require('fs');
const { PermissionsBitField } = require('discord.js');

module.exports = {
  name: "setprefix",
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

    // Load current prefixes
    let prefixes = {};
    try {
      prefixes = JSON.parse(fs.readFileSync('./prefixes.json', 'utf8'));
    } catch (err) {
      console.error('Error reading prefixes.json:', err.message);
    }

    // Save new prefix to file
    prefixes[message.guild.id] = newPrefix;
    try {
      fs.writeFileSync('./prefixes.json', JSON.stringify(prefixes, null, 2));
      return message.reply(`✅ Success! The prefix for this server has been changed to: \`${newPrefix}\``);
    } catch (err) {
      console.error('Error saving prefixes.json:', err.message);
      return message.reply('❌ An error occurred while saving the new prefix.');
    }
  }
};
