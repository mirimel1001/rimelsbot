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
    if (args[0] && args[0].toLowerCase() === 'all') {
      const { initMySQL, getLeftUsers } = require('../../utils/mysql.js');
      const dbPool = await initMySQL();
      const leftUsers = await getLeftUsers(guildId).catch(() => []);
      const leftUsersMap = new Map(leftUsers.map(u => [u.user_id, u.username]));

      const [rows] = await dbPool.query(
        `SELECT 
          user_id,
          SUM(CASE WHEN created_at > NOW() - INTERVAL 1 DAY THEN 1 ELSE 0 END) AS count_1d,
          SUM(CASE WHEN created_at > NOW() - INTERVAL 7 DAY THEN 1 ELSE 0 END) AS count_7d,
          COUNT(*) AS count_14d
         FROM activity_messages 
         WHERE guild_id = ? AND created_at > NOW() - INTERVAL 14 DAY
         GROUP BY user_id 
         ORDER BY count_14d DESC`,
        [guildId]
      );

      if (rows.length === 0) {
        return message.reply('ℹ️ No message activity recorded in the last 14 days for this server yet.');
      }

      let description = '🏆 **Rank | Name | ID | 1 Day | 7 Days | 14 Days**\n';
      let count = 0;
      const activeMembers = [];

      for (const row of rows) {
        const c14d = Number(row.count_14d) || 0;
        if (c14d <= 0) continue;

        // Check if user is still in the server
        const hasMember = message.guild.members.cache.has(row.user_id);
        if (!hasMember) {
          const fetchedMember = await message.guild.members.fetch(row.user_id).catch(() => null);
          if (!fetchedMember) {
            // User is not in the server, exclude them from active leaderboard display
            continue;
          }
        }

        activeMembers.push({ row, nameField: `<@${row.user_id}>` });
      }

      if (activeMembers.length === 0) {
        return message.reply('ℹ️ No message activity recorded in the last 14 days for this server yet.');
      }

      for (const item of activeMembers) {
        const { row, nameField } = item;
        const c14d = Number(row.count_14d) || 0;
        const c1d = Number(row.count_1d) || 0;
        const c7d = Number(row.count_7d) || 0;
        count++;
        if (count <= 25) {
          description += `#${count} | ${nameField} | \`${row.user_id}\` | \`${c1d.toLocaleString()}\` | \`${c7d.toLocaleString()}\` | \`${c14d.toLocaleString()}\`\n`;
        }
      }

      if (activeMembers.length > 25) {
        description += `\n*...and ${activeMembers.length - 25} more active users.*`;
      }

      description += `\n\n🔗 **[View Full Web Leaderboard](https://rbdb.vercel.app/?leaderboard=${guildId})**`;

      const embed = new EmbedBuilder()
        .setTitle('📊 Rolling Message Leaderboard')
        .setColor('#a855f7')
        .setDescription(description)
        .setFooter({ text: `Requested by ${message.author.tag}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
        .setTimestamp();

      return message.reply({ embeds: [embed] });
    }

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
