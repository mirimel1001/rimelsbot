const { PermissionsBitField, ChannelType } = require('discord.js');
const fs = require('fs');

module.exports = {
  name: "gamechannel",
  aliases: ["gc", "rgc"],
  category: "Administrative",
  adminOnly: true,
  description: "Sets a dedicated channel for minigames.\n\n" +
                "🔹 **Variables:**\n" +
                "• **[#channel]** - Mention the text channel to restrict games to.\n" +
                "• **clear** - Removes the restriction, allowing games anywhere.",
  usage: "gamechannel [#channel | clear]",
  run: async (client, message, args, prefix, config) => {
    // 1. Permission Check
    if (!message.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
      return message.reply("❌ You need **Manage Server** permissions to use this command.");
    }

    const input = args[0];
    const customPath = './custom_guilds.json';
    let data = { guilds: {} };

    // 2. Load settings
    try {
      if (fs.existsSync(customPath)) {
        data = JSON.parse(fs.readFileSync(customPath, 'utf8'));
      }
    } catch (err) {
      console.error("Error reading custom_guilds.json:", err);
    }

    if (!data.guilds) data.guilds = {};
    if (!data.guilds[message.guild.id]) data.guilds[message.guild.id] = {};
    if (!data.guilds[message.guild.id].gameSettings) data.guilds[message.guild.id].gameSettings = {};

    // 3. Handle 'clear'
    if (input?.toLowerCase() === 'clear') {
      delete data.guilds[message.guild.id].gameSettings.gameChannel;
      fs.writeFileSync(customPath, JSON.stringify(data, null, 2));
      
      // Update Cache
      const currentCache = client.gameSettings.get(message.guild.id) || {};
      delete currentCache.gameChannel;
      client.gameSettings.set(message.guild.id, currentCache);

      return message.reply("✅ The dedicated game channel has been **cleared**. Minigames can now be played anywhere.");
    }

    // 4. Handle setting channel
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(input);

    if (!channel || channel.type !== ChannelType.GuildText) { 
      return message.reply(`❌ Please mention a valid text channel or provide a valid ID.\nUsage: \`${prefix}gamechannel [#channel | clear]\``);
    }

    data.guilds[message.guild.id].gameSettings.gameChannel = channel.id;

    try {
      fs.writeFileSync(customPath, JSON.stringify(data, null, 2));
      
      // Update Cache
      const currentCache = client.gameSettings.get(message.guild.id) || {};
      currentCache.gameChannel = channel.id;
      client.gameSettings.set(message.guild.id, currentCache);

      return message.reply(`✅ Success! Minigames are now restricted to ${channel}.`);
    } catch (err) {
      console.error("Error writing custom_guilds.json:", err);
      return message.reply("❌ Failed to save the game channel setting.");
    }
  }
};
