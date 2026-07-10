const { EmbedBuilder } = require('discord.js');
const { checkConnection, getMessageCount } = require('../../utils/mysql.js');

module.exports = {
  name: "activity",
  aliases: ["user", "status", "stats"],
  category: "Activity Role Event",
  description: "Show message activity counts for a user over the last 1, 7, and 14 days.",
  usage: "activity [@user / userId]",
  run: async (client, message, args, prefix) => {
    // Check MySQL Connection status
    const isConnected = await checkConnection();
    if (!isConnected) {
      return message.reply('⚠️ **Database Warning:** The bot is currently unable to connect to the activity database. Message statistics are temporarily unavailable.');
    }

    const guildId = message.guild.id;

    // Resolve target user
    let targetUser = message.author;
    if (args[0]) {
      const query = args.join(' ').toLowerCase();
      const targetId = args[0].replace(/[<@!>]/g, '');
      try {
        targetUser = await client.users.fetch(targetId);
      } catch (err) {
        // Find by username, tag, or nickname in cache
        const member = message.guild.members.cache.find(m => 
          m.user.username.toLowerCase() === query || 
          m.user.tag.toLowerCase() === query || 
          (m.nickname && m.nickname.toLowerCase() === query)
        );
        if (member) {
          targetUser = member.user;
        } else {
          // Fallback to fetch search from guild API
          try {
            const fetchedMembers = await message.guild.members.fetch({ query, limit: 1 });
            const first = fetchedMembers.first();
            if (first) {
              targetUser = first.user;
            } else {
              return message.reply('❌ Invalid user specified. Please mention a user, provide a valid user ID, or provide a valid username.');
            }
          } catch (fetchErr) {
            return message.reply('❌ Invalid user specified. Please mention a user, provide a valid user ID, or provide a valid username.');
          }
        }
      }
    }

    // Retrieve stats
    const count1 = await getMessageCount(guildId, targetUser.id, 1);
    const count7 = await getMessageCount(guildId, targetUser.id, 7);
    const count14 = await getMessageCount(guildId, targetUser.id, 14);

    // Build response embed
    const embed = new EmbedBuilder()
      .setTitle(`📊 Message Activity - ${targetUser.username}`)
      .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
      .setColor('#a855f7')
      .setDescription(`Here is the rolling message activity count for **${targetUser.tag}** in this server:`)
      .addFields(
        { name: '📅 Last 24 Hours', value: `\`${count1.toLocaleString()}\` messages`, inline: true },
        { name: '📅 Last 7 Days', value: `\`${count7.toLocaleString()}\` messages`, inline: true },
        { name: '📅 Last 14 Days', value: `\`${count14.toLocaleString()}\` messages`, inline: true }
      )
      .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
      .setTimestamp();

    return message.reply({ embeds: [embed] });
  }
};
