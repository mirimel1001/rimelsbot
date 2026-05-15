const { EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
  name: "checkwinningrate",
  aliases: ["cwr"],
  description: "Check the winning rates configured for a specific game.\n\n" +
                "🔹 **Variables:**\n" +
                "• **[game name]** - The name or alias of the game (e.g., highlow or hl).",
  usage: "checkwinningrate [game name]",
  run: async (client, message, args, prefix, config) => {
    let inputGame = args[0]?.toLowerCase();
    if (!inputGame) {
      return message.reply(`❌ Usage: \`${prefix}checkwinningrate [game name]\``);
    }

    // Resolve game name from aliases/names in client commands
    const command = client.commands.get(inputGame) || 
                    client.commands.find(cmd => cmd.name.toLowerCase() === inputGame || (cmd.aliases && cmd.aliases.includes(inputGame)));

    if (!command || command.category !== "Games") {
      const minigamesDir = './cmds/minigames/';
      const folders = fs.readdirSync(minigamesDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name.toLowerCase());

      if (!folders.includes(inputGame)) {
        return message.reply(`❌ Please provide a valid minigame name (e.g., \`highlow\`, \`bet\`, \`imageguess\`).`);
      }
    }

    const gameName = command ? command.name.toLowerCase() : inputGame;

    try {
      // Clean up the Main Guild ID (remove any quotes or spaces)
      const mainGuildId = process.env.MAIN_GUILD_ID?.trim().replace(/^["'](.+)["']$/, '$1');
      
      // Get settings for the Current Guild and the Main Guild
      const guildSettings = client.gameSettings.get(message.guild.id) || {};
      const mainSettings = client.gameSettings.get(mainGuildId) || {};

      const globalDefaults = mainSettings.winningRates?.[gameName] || {};
      const localSettings = guildSettings.winningRates?.[gameName] || {};

      const mergedRates = { ...globalDefaults, ...localSettings };

      if (Object.keys(mergedRates).length === 0) {
        return message.reply(`❌ No winning rates found for the game **${gameName}**.`);
      }

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📊 Win Rates: ${gameName.toUpperCase()}`)
        .setDescription(`Showing all role-based chances for **${gameName}**. If a player has multiple roles, the highest chance is used.`)
        .setTimestamp()
        .setFooter({ text: 'Wispbyte Modular Bot' });

      let list = "";
      for (const [roleId, percentage] of Object.entries(mergedRates)) {
        const role = message.guild.roles.cache.get(roleId);
        const roleName = role ? role.name : `<Deleted Role: ${roleId}>`;
        list += `🔹 **${roleName}**: \`${percentage}%\`\n`;
      }

      embed.addFields({ name: 'Role Chances', value: list || 'No rates defined.' });

      return message.reply({ embeds: [embed] });

    } catch (err) {
      console.error("Error reading winning rates:", err);
      return message.reply("❌ Failed to read the winning rate data.");
    }
  }
};
