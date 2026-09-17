const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const crypto = require('crypto');
const {
  getCountActivitiesByGuild,
  getCountActivityByChannel,
  findCountActivity,
  saveCountActivity,
  deleteCountActivity
} = require('../../utils/mysql.js');

module.exports = {
  name: 'count',
  aliases: ['counting'],
  category: 'minigames',
  description: 'Manage and configure multi-channel dynamic counting activities.',
  usage: 'count setup | list | showlast | create [name] | edit [name/id] [setting] [value] | status [name/id] | delete [name/id]',
  run: async (client, message, args, prefix, config) => {
    const subCmd = args[0] ? args[0].toLowerCase() : null;

    // 1. SHOWLAST / SL COMMAND (On-Demand Query in active counting channel or by name/id)
    if (subCmd === 'showlast' || subCmd === 'sl' || subCmd === 'last') {
      const target = args[1] || message.channel.id;
      const act = await findCountActivity(message.guild.id, target);
      if (!act) {
        return message.reply('❌ No counting activity found for this channel. Use `' + prefix + 'count list` to see all counting channels.');
      }

      const embed = new EmbedBuilder()
        .setTitle('🔢 ' + act.name + ' — Current Count')
        .setColor('#5865F2')
        .setDescription(
          '• Last Correct Count: **' + act.currentNumber + '**\n' +
          '• Next Expected Count: **' + (act.currentNumber + 1) + '**\n' +
          '• High Score: **' + act.highScore + '**\n' +
          '• Last Counter: ' + (act.lastUserId ? '<@' + act.lastUserId + '>' : 'None') + '\n' +
          '• Mode: ' + (act.strictMode ? '🔴 Strict (Mistakes reset)' : '🟢 Relaxed') + '\n' +
          '• Channel: <#' + act.channelId + '>'
        )
        .setFooter({ text: 'Rimeverse Counting System' });

      return message.reply({ embeds: [embed] });
    }

    // 2. HELP / SETUP GUIDE
    if (!subCmd || subCmd === 'setup' || subCmd === 'help') {
      const helpEmbed = new EmbedBuilder()
        .setTitle('🔢 Dynamic Counting Activity — Setup & Commands')
        .setColor('#5865F2')
        .setDescription('Create and customize series counting games in any channel!')
        .addFields(
          {
            name: '📋 Player & Management Commands',
            value: [
              '`' + prefix + 'count showlast` (or `count sl`) — Check the last valid number in the current channel.',
              '`' + prefix + 'count setup` — Show this setup instructions guide.',
              '`' + prefix + 'count list` — List all counting activities in this server.',
              '`' + prefix + 'count create [name] [#channel]` — Create a new counting activity for a channel.',
              '`' + prefix + 'count status [name/id]` — Show detailed configuration and current count.',
              '`' + prefix + 'count delete [name/id]` — Delete a counting activity.'
            ].join('\n')
          },
          {
            name: '⚙️ Configuration Commands (`count edit [name/id] <setting> <value>`)',
            value: [
              '`' + prefix + 'count edit [name/id] strict [true/false]`\n*Strict mode: mistakes reset counter back to 0.*',
              '`' + prefix + 'count edit [name/id] [number]` (or `number [n]`)\n*Set current starting / resumed number.*',
              '`' + prefix + 'count edit [name/id] cm [true/false]`\n*Consecutive Messages: allow same user to count one after another.*',
              '`' + prefix + 'count edit [name/id] cmd [true/false]`\n*Consecutive Messages Delete: delete consecutive attempts by the same user.*',
              '`' + prefix + 'count edit [name/id] reaction [emoji]`\n*Reaction emoji used to confirm correct counts.*',
              '`' + prefix + 'count edit [name/id] deletechat [true/false]`\n*Delete normal chat messages that are not counts.*'
            ].join('\n\n')
          }
        )
        .setFooter({ text: 'Rimeverse Counting Engine • Requested by ' + message.author.tag, iconURL: message.author.displayAvatarURL() });

      return message.reply({ embeds: [helpEmbed] });
    }

    // Permission check for modifying commands
    const isMod = message.member.permissions.has(PermissionsBitField.Flags.ManageChannels) ||
                  message.member.permissions.has(PermissionsBitField.Flags.Administrator) ||
                  (client.owners && client.owners.includes(message.author.id));

    // 3. LIST ALL ACTIVITIES
    if (subCmd === 'list') {
      try {
        const activities = await getCountActivitiesByGuild(message.guild.id);
        if (!activities || activities.length === 0) {
          return message.reply('ℹ️ There are no counting activities set up in this server. Create one using `' + prefix + 'count create [name]`!');
        }

        const embed = new EmbedBuilder()
          .setTitle('🔢 Counting Activities (' + activities.length + ')')
          .setColor('#00D166')
          .setDescription(activities.map((act, index) => {
            const channelMention = '<#' + act.channelId + '>';
            const strict = act.strictMode ? '🔴 Strict' : '🟢 Relaxed';
            const cm = act.allowConsecutive ? 'Allow Double' : 'No Double';
            return '**' + (index + 1) + '. ' + act.name + '** (`ID: ' + act.activityId + '`)\n' +
                   '• Channel: ' + channelMention + '\n' +
                   '• Current Count: **' + act.currentNumber + '** (High Score: **' + act.highScore + '**)\n' +
                   '• Mode: ' + strict + ' | CM: ' + cm + ' | Reaction: ' + act.reactionEmoji + ' | DeleteChat: ' + (act.deleteChat ? 'On' : 'Off') + '\n';
          }).join('\n'))
          .setFooter({ text: 'Use "' + prefix + 'count status [name/id]" for details' });

        return message.reply({ embeds: [embed] });
      } catch (err) {
        console.error('[Count List Error]', err);
        return message.reply('❌ Failed to fetch counting activities from database.');
      }
    }

    if (!isMod) {
      return message.reply('❌ You need **Manage Channels** or **Administrator** permissions to create and configure counting activities.');
    }

    // 4. CREATE ACTIVITY
    if (subCmd === 'create') {
      const name = args[1];
      if (!name) {
        return message.reply('❌ Please provide a name for this counting activity.\nExample: `' + prefix + 'count create general-count` or `' + prefix + 'count create general-count #counting`');
      }

      // Check target channel (default: current channel)
      const targetChannel = message.mentions.channels.first() || 
                            message.guild.channels.cache.get(args[2]) || 
                            message.channel;

      if (!targetChannel || !targetChannel.isTextBased()) {
        return message.reply('❌ Please specify a valid text channel for counting.');
      }

      try {
        // Check if channel is already registered in MySQL
        const existingInChannel = await getCountActivityByChannel(targetChannel.id);
        if (existingInChannel) {
          return message.reply('⚠️ Channel <#' + targetChannel.id + '> already has an active counting activity (**' + existingInChannel.name + '** `ID: ' + existingInChannel.activityId + '`). Use `' + prefix + 'count edit` or delete the old one first.');
        }

        // Check if name already exists in guild
        const existingName = await findCountActivity(message.guild.id, name);
        if (existingName) {
          return message.reply('⚠️ An activity named **' + name + '** already exists in this server. Please choose a unique name.');
        }

        const activityId = 'cnt_' + crypto.randomBytes(3).toString('hex');

        const newActivity = {
          activityId: activityId,
          guildId: message.guild.id,
          channelId: targetChannel.id,
          name: name,
          currentNumber: 0,
          lastUserId: null,
          lastBotMessageId: null,
          highScore: 0,
          strictMode: false,
          allowConsecutive: false,
          deleteConsecutive: true,
          reactionEmoji: '✅',
          deleteChat: false,
          showLast: false,
          isActive: true
        };

        await saveCountActivity(newActivity);

        // Update in-memory bot cache
        if (client.countActivities) {
          client.countActivities.set(targetChannel.id, newActivity);
        }

        const createdEmbed = new EmbedBuilder()
          .setTitle('✅ Counting Activity Created!')
          .setColor('#00D166')
          .setDescription('Successfully created **' + name + '** in <#' + targetChannel.id + '>!')
          .addFields(
            { name: 'Activity ID', value: '`' + activityId + '`', inline: true },
            { name: 'Starting Count', value: '**0** (Next: 1)', inline: true },
            { name: 'Channel', value: '<#' + targetChannel.id + '>', inline: true },
            {
              name: '👉 Next Recommended Steps:',
              value: [
                '• Check last count anytime: `' + prefix + 'count showlast` (or `count sl`)',
                '• Set starting number: `' + prefix + 'count edit ' + name + ' 0` (or custom starting number)',
                '• Set strict mode: `' + prefix + 'count edit ' + name + ' strict true/false`',
                '• Set consecutive count rule: `' + prefix + 'count edit ' + name + ' cm true/false`',
                '• Set custom reaction: `' + prefix + 'count edit ' + name + ' reaction 🔢`',
                '• Set clean chat mode: `' + prefix + 'count edit ' + name + ' deletechat true/false`'
              ].join('\n')
            }
          );

        return message.reply({ embeds: [createdEmbed] });
      } catch (err) {
        console.error('[Count Create Error]', err);
        return message.reply('❌ Failed to create counting activity.');
      }
    }

    // 5. STATUS COMMAND
    if (subCmd === 'status') {
      const target = args[1] || message.channel.id;
      const act = await findCountActivity(message.guild.id, target);
      if (!act) {
        return message.reply('❌ Could not find counting activity matching `' + target + '`. Use `' + prefix + 'count list` to see all activities.');
      }

      const statusEmbed = new EmbedBuilder()
        .setTitle('🔢 Status: ' + act.name)
        .setColor('#5865F2')
        .addFields(
          { name: 'Activity ID', value: '`' + act.activityId + '`', inline: true },
          { name: 'Channel', value: '<#' + act.channelId + '>', inline: true },
          { name: 'Current Count', value: '**' + act.currentNumber + '** (Next: **' + (act.currentNumber + 1) + '**)', inline: true },
          { name: 'High Score', value: '**' + act.highScore + '**', inline: true },
          { name: 'Last Counter', value: act.lastUserId ? '<@' + act.lastUserId + '>' : 'None', inline: true },
          { name: 'Confirmation Emoji', value: act.reactionEmoji, inline: true },
          { name: 'Strict Mode', value: act.strictMode ? '🔴 Enabled (Mistakes reset to 0)' : '🟢 Disabled (Mistakes ignored/deleted)', inline: true },
          { name: 'Consecutive Messages (cm)', value: act.allowConsecutive ? 'Allowed' : 'Blocked (Must alternate users)', inline: true },
          { name: 'Consecutive Delete (cmd)', value: act.deleteConsecutive ? 'Auto-delete' : 'Keep message', inline: true },
          { name: 'Delete Chat (deletechat)', value: act.deleteChat ? 'Enabled (Deletes normal chat)' : 'Disabled (Allows chat)', inline: true }
        )
        .setFooter({ text: 'Rimeverse Counting Engine (MySQL)' });

      return message.reply({ embeds: [statusEmbed] });
    }

    // 6. DELETE COMMAND
    if (subCmd === 'delete' || subCmd === 'remove') {
      const target = args[1];
      if (!target) {
        return message.reply('❌ Please specify the activity name or ID to delete.\nUsage: `' + prefix + 'count delete [name/id]`');
      }

      const act = await findCountActivity(message.guild.id, target);
      if (!act) {
        return message.reply('❌ Could not find counting activity matching `' + target + '`.');
      }

      await deleteCountActivity(act.activityId);
      if (client.countActivities) {
        client.countActivities.delete(act.channelId);
      }

      return message.reply('✅ Successfully deleted counting activity **' + act.name + '** (`ID: ' + act.activityId + '`).');
    }

    // 7. EDIT COMMAND
    if (subCmd === 'edit') {
      const target = args[1];
      if (!target) {
        return message.reply('❌ Please provide the activity name or ID.\nUsage: `' + prefix + 'count edit [name/id] [setting] [value]`');
      }

      const act = await findCountActivity(message.guild.id, target);
      if (!act) {
        return message.reply('❌ Could not find counting activity matching `' + target + '`. Use `' + prefix + 'count list` to view all.');
      }

      const setting = args[2] ? args[2].toLowerCase() : null;
      const val = args[3] ? args[3].toLowerCase() : null;

      // Case A: count edit [name/id] [number] (direct number shorthand)
      if (setting && !isNaN(parseInt(setting)) && args.length === 3) {
        const newNum = parseInt(setting);
        act.currentNumber = newNum;
        act.lastUserId = null;
        if (newNum > act.highScore) act.highScore = newNum;
        await saveCountActivity(act);
        if (client.countActivities) client.countActivities.set(act.channelId, act);
        return message.reply('✅ Current count for **' + act.name + '** updated to **' + newNum + '** (Next expected: **' + (newNum + 1) + '**).');
      }

      if (!setting) {
        return message.reply('❌ Please provide a setting to edit. Available: `strict`, `number`, `cm`, `cmd`, `reaction`, `deletechat`.');
      }

      // Case B: Strict Mode
      if (setting === 'strict') {
        if (val !== 'true' && val !== 'false') {
          return message.reply('❌ Usage: `' + prefix + 'count edit ' + target + ' strict true/false`');
        }
        act.strictMode = (val === 'true');
        await saveCountActivity(act);
        if (client.countActivities) client.countActivities.set(act.channelId, act);
        return message.reply('✅ **Strict Mode** for **' + act.name + '** is now **' + (act.strictMode ? 'Enabled (Mistakes reset count to 0)' : 'Disabled') + '**.');
      }

      // Case C: Start / Number
      if (setting === 'number' || setting === 'start' || setting === 'setnumber') {
        const numVal = parseInt(args[3]);
        if (isNaN(numVal)) {
          return message.reply('❌ Please provide a valid integer number.\nUsage: `' + prefix + 'count edit ' + target + ' number [number]`');
        }
        act.currentNumber = numVal;
        act.lastUserId = null;
        if (numVal > act.highScore) act.highScore = numVal;
        await saveCountActivity(act);
        if (client.countActivities) client.countActivities.set(act.channelId, act);
        return message.reply('✅ Current count for **' + act.name + '** set to **' + numVal + '** (Next expected: **' + (numVal + 1) + '**).');
      }

      // Case D: Consecutive Messages (cm)
      if (setting === 'cm' || setting === 'consecutive' || setting === 'consecutivemessages') {
        if (val !== 'true' && val !== 'false') {
          return message.reply('❌ Usage: `' + prefix + 'count edit ' + target + ' cm true/false`');
        }
        act.allowConsecutive = (val === 'true');
        await saveCountActivity(act);
        if (client.countActivities) client.countActivities.set(act.channelId, act);
        return message.reply('✅ **Consecutive Messages (cm)** for **' + act.name + '** is now **' + (act.allowConsecutive ? 'Allowed' : 'Blocked (Users must alternate)') + '**.');
      }

      // Case E: Consecutive Messages Delete (cmd)
      if (setting === 'cmd' || setting === 'consecutivedelete' || setting === 'consecutivemessagesdelete') {
        if (val !== 'true' && val !== 'false') {
          return message.reply('❌ Usage: `' + prefix + 'count edit ' + target + ' cmd true/false`');
        }
        act.deleteConsecutive = (val === 'true');
        await saveCountActivity(act);
        if (client.countActivities) client.countActivities.set(act.channelId, act);
        return message.reply('✅ **Consecutive Messages Delete (cmd)** for **' + act.name + '** is now **' + (act.deleteConsecutive ? 'Enabled (Auto-deletes same user duplicates)' : 'Disabled') + '**.');
      }

      // Case F: Reaction / Emoji
      if (setting === 'reaction' || setting === 'emoji') {
        const emojiInput = args[3];
        if (!emojiInput) {
          return message.reply('❌ Please provide an emoji or custom emoji string.\nUsage: `' + prefix + 'count edit ' + target + ' reaction [emoji]`');
        }
        act.reactionEmoji = emojiInput;
        await saveCountActivity(act);
        if (client.countActivities) client.countActivities.set(act.channelId, act);
        return message.reply('✅ Confirmation reaction for **' + act.name + '** set to ' + emojiInput);
      }

      // Case G: DeleteChat
      if (setting === 'deletechat' || setting === 'chatdelete' || setting === 'clean') {
        if (val !== 'true' && val !== 'false') {
          return message.reply('❌ Usage: `' + prefix + 'count edit ' + target + ' deletechat true/false`');
        }
        act.deleteChat = (val === 'true');
        await saveCountActivity(act);
        if (client.countActivities) client.countActivities.set(act.channelId, act);
        return message.reply('✅ **DeleteChat** for **' + act.name + '** is now **' + (act.deleteChat ? 'Enabled (Deletes normal non-count messages)' : 'Disabled (Allows normal chat)') + '**.');
      }

      return message.reply('❌ Unknown setting `' + setting + '`. Available settings: `strict`, `number`, `cm`, `cmd`, `reaction`, `deletechat`.');
    }

    return message.reply('❌ Unknown subcommand. Use `' + prefix + 'count setup` to see all available commands.');
  }
};
