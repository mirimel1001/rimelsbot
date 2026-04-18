const { PermissionsBitField } = require('discord.js');
const fs = require('fs');

module.exports = {
  name: "gamechannel",
  aliases: ["gc", "rgc"],
  description: "Sets a dedicated channel for minigames.",
  usage: "gamechannel [#channel | clear]",
  run: async (client, message, args, prefix, config) => {
    // 1. Permission Check
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("❌ You need **Manage Server** permissions to use this command.");
    }

    const input = args[0];
    const filePath = './server_game_settings.json';

    // 2. Load settings
    let settingsData = { guilds: {} };
    try {
      if (fs.existsSync(filePath)) {
        settingsData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.error("Error reading server_game_settings.json:", err);
    }

    if (!settingsData.guilds[message.guild.id]) settingsData.guilds[message.guild.id] = {};

    // 3. Handle 'clear'
    if (input?.toLowerCase() === 'clear') {
      delete settingsData.guilds[message.guild.id].gameChannel;
      fs.writeFileSync(filePath, JSON.stringify(settingsData, null, 2));
      return message.reply("✅ The dedicated game channel has been **cleared**. Minigames can now be played anywhere.");
    }

    // 4. Handle setting channel
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(input);

    if (!channel || channel.type !== 0) { // 0 is text channel
      return message.reply(`❌ Please mention a valid text channel or provide a valid ID.\nUsage: \`${prefix}gamechannel [#channel | clear]\``);
    }

    settingsData.guilds[message.guild.id].gameChannel = channel.id;

    try {
      fs.writeFileSync(filePath, JSON.stringify(settingsData, null, 2));
      return message.reply(`✅ Success! Minigames are now restricted to ${channel}.`);
    } catch (err) {
      console.error("Error writing game_settings.json:", err);
      return message.reply("❌ Failed to save the game channel setting.");
    }
  }
};
