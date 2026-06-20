const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const HgmGroup = require('../../models/HgmGroup');

module.exports = {
  name: "hgm",
  description: "Owner-only commands to manage a broadcast list and send direct messages.",
  usage: "hgm [add/remove/list/text/pm/delete] [args]",
  ownerOnly: true,
  run: async (client, message, args, prefix, config) => {
    // 1. Owner Check
    if (!client.owners.has(message.author.id)) {
      // Quietly ignore
      return;
    }

    const subCommand = args[0]?.toLowerCase();

    // Helper: Show usage details
    const showHelp = () => {
      const isDM = !message.guild;
      const cmdPrefix = isDM ? 'h ' : (prefix || 'r') + ' hgm ';
      
      const embed = new EmbedBuilder()
        .setTitle('⚙️ Broadcast Commands')
        .setColor('#5865F2')
        .setDescription('Manage a private list of members and broadcast direct messages to them.')
        .addFields(
          { name: `\`${cmdPrefix}add <user>\``, value: 'Add a user by mention or user ID.' },
          { name: `\`${cmdPrefix}remove <user>\``, value: 'Remove a user by mention or user ID.' },
          { name: `\`${cmdPrefix}list\``, value: 'Show group members (sends to DMs if run in server).' },
          { name: `\`${cmdPrefix}text {exclusions} <your message>\``, value: 'Sends a DM to all members except those inside `{}`. Exclusions can be list indices or Discord user IDs.' },
          { name: `\`${cmdPrefix}pm {exclusions} <your message>\``, value: 'Sends a DM to all members except those inside `{}`.' }
        );
      return message.reply({ embeds: [embed] });
    };

    if (!subCommand) return showHelp();

    // 2. Subcommands routing
    switch (subCommand) {
      case 'add': {
        const targetInput = args[1];
        if (!targetInput) return message.reply('❌ Please specify a user ID or mention.');

        const match = targetInput.match(/^(?:<@!?([0-9]+)>|([0-9]+))$/);
        const targetId = match ? (match[1] || match[2]) : null;
        if (!targetId) return message.reply('❌ Invalid user format. Please use a mention or raw user ID.');

        const user = await client.users.fetch(targetId).catch(() => null);
        if (!user) return message.reply('❌ Could not find that user on Discord.');

        const existing = await HgmGroup.findOne({ userId: user.id });
        if (existing) {
          return message.reply(`ℹ️ **${user.displayName || user.username}** is already in the list.`);
        }

        await HgmGroup.create({
          userId: user.id,
          displayName: user.displayName || user.username,
          username: user.username,
          mention: `<@${user.id}>`
        });

        return message.reply(`✅ Added **${user.displayName || user.username}** to the group list.`);
      }

      case 'remove': {
        const targetInput = args[1];
        if (!targetInput) return message.reply('❌ Please specify a user ID or mention.');

        const match = targetInput.match(/^(?:<@!?([0-9]+)>|([0-9]+))$/);
        const targetId = match ? (match[1] || match[2]) : null;
        if (!targetId) return message.reply('❌ Invalid user format. Please use a mention or raw user ID.');

        const result = await HgmGroup.findOneAndDelete({ userId: targetId });
        if (!result) {
          return message.reply('❌ That user is not in the list.');
        }

        return message.reply(`✅ Removed **${result.displayName}** from the group list.`);
      }

      case 'list': {
        const members = await HgmGroup.find().sort({ createdAt: 1 });
        if (members.length === 0) {
          return message.reply('ℹ️ The group list is currently empty.');
        }

        const embed = new EmbedBuilder()
          .setTitle(`👥 Group Members (${members.length})`)
          .setColor('#5865F2')
          .setDescription(
            members.map((m, idx) => {
              return `**${idx + 1}.** ${m.displayName} (@${m.username}) - ${m.mention} (ID: \`${m.userId}\`)`;
            }).join('\n')
          )
          .setTimestamp();

        // Add a delete button to allow deleting the list message manually
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('hgm_delete_list')
            .setLabel('🗑️ Delete Message')
            .setStyle(ButtonStyle.Danger)
        );

        if (message.guild) {
          // If in server, send list to the owner's DM to keep it secret
          try {
            await message.author.send({ embeds: [embed], components: [row] });
            const rep = await message.reply('📩 **Sent the group list to your DMs.**');
            
            // Delete trigger and temporary reply after 3 seconds
            setTimeout(() => {
              message.delete().catch(() => {});
              rep.delete().catch(() => {});
            }, 3000);
          } catch (err) {
            // Fallback if DMs are blocked
            return message.reply('❌ Could not DM you the list. Please check if your DMs are open.');
          }
        } else {
          // If already in DM, reply directly
          return message.reply({ embeds: [embed], components: [row] });
        }
        break;
      }



      case 'text':
      case 'pm': {
        // Parse args for exclusions in curly brackets
        const rawContent = message.content;
        const subIndex = rawContent.toLowerCase().indexOf(' ' + subCommand);
        if (subIndex === -1) return message.reply('❌ Message parsing error.');
        
        const subArgs = rawContent.slice(subIndex + subCommand.length + 1).trim();
        if (!subArgs) return message.reply('❌ Please specify a message to send.');

        const curlyMatch = subArgs.match(/^\{([^}]+)\}/);
        let excludedKeys = [];
        let msgText = subArgs;

        if (curlyMatch) {
          const inner = curlyMatch[1];
          excludedKeys = inner.split(',').map(s => s.trim().toLowerCase());
          msgText = subArgs.slice(curlyMatch[0].length).trim();
        }

        if (!msgText) return message.reply('❌ Please specify a message after the exclusions.');

        const members = await HgmGroup.find().sort({ createdAt: 1 });
        if (members.length === 0) {
          return message.reply('❌ The group list is empty. Add members first.');
        }

        const progressMsg = await message.reply('📨 Sending messages to group members...');

        let successCount = 0;
        let failCount = 0;
        let excludeCount = 0;
        const fails = [];

        for (const [index, member] of members.entries()) {
          const i = index + 1;
          const isExcluded = excludedKeys.some(key => key === String(i) || key === member.userId);
          
          if (isExcluded) {
            excludeCount++;
            continue;
          }

          try {
            const user = await client.users.fetch(member.userId);
            const broadcastEmbed = new EmbedBuilder()
              .setColor('#5865F2')
              .setAuthor({ name: `Message from ${message.author.username}`, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
              .setDescription(`${msgText}\n\n---\n✉️ *This message was sent to you by **${message.author.username}** (<@${message.author.id}>).*`)
              .setFooter({ text: '💡 Reply in DMs using: h reply [text] | h r [text]' })
              .setTimestamp();
            
            await user.send({ embeds: [broadcastEmbed] });
            successCount++;
          } catch (err) {
            failCount++;
            fails.push(`- **${member.displayName}** (ID: \`${member.userId}\`): ${err.message}`);
          }
        }

        let summary = `✅ **Broadcast Completed!**\n\n`;
        summary += `- **Sent:** ${successCount}\n`;
        summary += `- **Excluded:** ${excludeCount}\n`;
        summary += `- **Failed:** ${failCount}\n`;

        if (failCount > 0) {
          summary += `\n**Unable to DM the following users:**\n${fails.join('\n')}`;
        }

        await progressMsg.edit(summary);
        break;
      }

      default:
        return showHelp();
    }
  }
};
