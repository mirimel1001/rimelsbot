const { PermissionsBitField, ChannelType } = require('discord.js');

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

    const Guild = require('../../models/Guild');
    const input = args[0];

    // 3. Handle 'clear'
    if (input?.toLowerCase() === 'clear') {
      const currentCache = client.gameSettings.get(message.guild.id) || {};
      delete currentCache.gameChannel;

      await Guild.findOneAndUpdate(
        { guildId: message.guild.id },
        { gameSettings: currentCache },
        { upsert: true }
      );
      
      client.gameSettings.set(message.guild.id, currentCache);
      return message.reply("✅ The dedicated game channel has been **cleared**. Minigames can now be played anywhere.");
    }

    // 4. Handle setting channel
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(input);

    if (!channel || channel.type !== ChannelType.GuildText) { 
      return message.reply(`❌ Please mention a valid text channel or provide a valid ID.\nUsage: \`${prefix}gamechannel [#channel | clear]\``);
    }

    try {
      const currentCache = client.gameSettings.get(message.guild.id) || {};
      currentCache.gameChannel = channel.id;

      await Guild.findOneAndUpdate(
        { guildId: message.guild.id },
        { gameSettings: currentCache },
        { upsert: true }
      );
      
      client.gameSettings.set(message.guild.id, currentCache);
      return message.reply(`✅ Success! Minigames are now restricted to ${channel}.`);
    } catch (err) {
      console.error("Error updating Database:", err);
      return message.reply("❌ Failed to save the game channel setting.");
    }
  }
};
