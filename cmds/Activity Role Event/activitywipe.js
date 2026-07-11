const { PermissionsBitField } = require('discord.js');
const { checkConnection, wipeUserActivity } = require('../../utils/mysql.js');

module.exports = {
  name: "activitywipe",
  aliases: ["awipe", "activityreset", "areset", "statswipe", "userswipe"],
  category: "Activity Role Event",
  adminOnly: true,
  description: "Wipe all or a specific number of message activity logs for a user.",
  usage: "activitywipe [@user / userId] [number of messages]",
  run: async (client, message, args, prefix) => {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need **Administrator** permissions to use this command.');
    }

    const isConnected = await checkConnection();
    if (!isConnected) {
      return message.reply('⚠️ **Database Error:** The activity database is currently offline.');
    }

    const targetArg = args[0];
    if (!targetArg) {
      return message.reply(`❌ Usage: \`${prefix}activitywipe [@user / userId] [number to delete (optional)]\``);
    }

    // Resolve target user ID
    let targetId = targetArg.replace(/[<@!>]/g, '');
    let targetUser;
    try {
      targetUser = await client.users.fetch(targetId);
    } catch (err) {
      return message.reply('❌ Invalid user specified. Please mention a user or provide a valid user ID.');
    }

    // Resolve amount to wipe
    let wipeAmount = null;
    if (args[1]) {
      wipeAmount = parseInt(args[1], 10);
      if (isNaN(wipeAmount) || wipeAmount <= 0) {
        return message.reply('❌ Please specify a valid positive number of messages to wipe.');
      }
    }

    try {
      const deletedCount = await wipeUserActivity(message.guild.id, targetUser.id, wipeAmount);
      
      if (wipeAmount) {
        return message.reply(`✅ Successfully wiped **${deletedCount}** of the most recent message activity records for **${targetUser.tag}**.`);
      } else {
        return message.reply(`✅ Successfully wiped all **${deletedCount}** message activity records for **${targetUser.tag}**.`);
      }
    } catch (err) {
      console.error('[Wipe Command Error]', err);
      return message.reply('❌ An error occurred while trying to wipe the user activity.');
    }
  }
};
