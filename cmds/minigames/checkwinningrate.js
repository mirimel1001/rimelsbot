const { EmbedBuilder } = require('discord.js');
const fs = require('fs');

module.exports = {
  name: "checkwinningrate",
  aliases: ["cwr"],
  description: "Check the winning rates for all roles in a specific game.",
  usage: "checkwinningrate [game name]",
  run: async (client, message, args, prefix, config) => {
    const gameName = args[0]?.toLowerCase();

    // 1. Validate against existing minigames
    const minigamesDir = './cmds/minigames/';
    const folders = fs.readdirSync(minigamesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name.toLowerCase().replace(/ /g, '')); // e.g. "highlow"

    if (!gameName || !folders.includes(gameName)) {
      const gameList = folders.map(f => `\`${f}\``).join(', ');
      return message.reply(`❌ Please provide a valid minigame name.\nAvailable games: ${gameList}`);
    }

    const filePath = './winning_rates.json';
    if (!fs.existsSync(filePath)) {
      return message.reply("❌ Winning rates have not been configured yet.");
    }

    try {
      const winData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      // Load and Merge
      const globalDefaults = winData.defaults || {};
      const guildSettings = winData.guilds[message.guild.id]?.[gameName] || {};
      const mergedRates = { ...globalDefaults, ...guildSettings };

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
