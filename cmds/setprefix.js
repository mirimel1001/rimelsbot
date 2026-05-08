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
      const customPath = './custom_guilds.json';
      let data = { guilds: {} };
      
      if (fs.existsSync(customPath)) {
        data = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      }
      
      if (!data.guilds) data.guilds = {};
      if (!data.guilds[message.guild.id]) data.guilds[message.guild.id] = {};
      
      data.guilds[message.guild.id].prefix = newPrefix;
      
      fs.writeFileSync(customPath, JSON.stringify(data, null, 2));
      client.prefixes.set(message.guild.id, newPrefix);

      return message.reply(`✅ Prefix updated! The new prefix for this server is \`${newPrefix}\``);
    } catch (err) {
      console.error('Error updating custom_guilds.json:', err.message);
      return message.reply(`❌ Failed to save the new prefix.`);
    }
  }
};
