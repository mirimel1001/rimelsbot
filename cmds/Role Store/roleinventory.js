const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, PermissionsBitField } = require('discord.js');
const Inventory = require('../../models/Inventory');

function formatDuration(ms) {
  if (ms <= 0) return "Permanent";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatPreciseDuration(ms) {
  if (ms <= 0) return "0s";
  let seconds = Math.floor(ms / 1000);
  let minutes = Math.floor(seconds / 60);
  let hours = Math.floor(minutes / 60);
  let days = Math.floor(hours / 24);

  seconds %= 60;
  minutes %= 60;
  hours %= 24;

  const parts = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? 's' : ''}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? 's' : ''}`);
  if (minutes > 0) parts.push(`${minutes} minute${minutes !== 1 ? 's' : ''}`);
  if (seconds > 0) parts.push(`${seconds} second${seconds !== 1 ? 's' : ''}`);

  return parts.join(' ');
}

module.exports = {
  name: "roleinventory",
  aliases: ["i", "inv", "inventory"],
  description: "View your purchased role inventory, showing active wearers and timers.",
  usage: "inv",
  run: async (client, message, args, prefix, config) => {
    if (!message.guild) return message.reply("❌ Inventories can only be viewed within a server.");

    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);
    const firstArg = args[0]?.toLowerCase();

    // --- ADMIN CLEAR / WIPE COMMAND ---
    if (firstArg === 'clear' || firstArg === 'wipe') {
      if (!isAdmin) {
        return message.reply("❌ Only administrators can wipe/clear inventories.");
      }

      const userArg = args[1];
      if (!userArg) {
        return message.reply(`❌ **Usage:** \`${prefix}ri wipe [@user/UserID]\``);
      }

      const cleanId = userArg.replace(/[<@!>]/g, '');
      const member = await message.guild.members.fetch(cleanId).catch(() => null);
      if (!member) {
        return message.reply("❌ Invalid user provided.");
      }

      let targetInv = await Inventory.findOne({ guildId: message.guild.id, userId: member.id });
      if (!targetInv || !targetInv.roles || targetInv.roles.length === 0) {
        return message.reply(`📭 ${member.user.username}'s inventory is already empty.`);
      }

      // Strip all equipped roles on Discord from this inventory
      for (const item of targetInv.roles) {
        if (item.isUsed) {
          const wearerMember = await message.guild.members.fetch(item.assignedTo).catch(() => null);
          if (wearerMember) {
            const discordRole = await message.guild.roles.fetch(item.roleId).catch(() => null);
            if (discordRole) {
              try {
                await wearerMember.roles.remove(discordRole);
              } catch (err) {
                console.error('[Wipe Discord Error]', err);
              }
            }
          }
        }
      }

      targetInv.roles = [];
      await targetInv.save();

      return message.reply(`🗑️ **Inventory Wiped:** Successfully cleared all items from **${member.user.username}**'s inventory.`);
    }

    // --- DELETE / DISCARD COMMAND ---
    if (firstArg === 'discard' || firstArg === 'remove' || firstArg === 'delete' || firstArg === 'del') {
      let targetUser = message.author;
      let indexInput = args[1];

      // Check if deleting someone else's item as admin
      const possibleUserArg = args[1];
      if (possibleUserArg) {
        const cleanId = possibleUserArg.replace(/[<@!>]/g, '');
        const member = await message.guild.members.fetch(cleanId).catch(() => null);
        if (member) {
          if (!isAdmin) {
            return message.reply("❌ Only administrators can manage other users' inventories.");
          }
          targetUser = member.user;
          indexInput = args[2];
        }
      }

      if (!indexInput) {
        if (targetUser.id !== message.author.id) {
          return message.reply(`❌ **Usage:** \`${prefix}ri del @user [inventory id/number]\``);
        }
        return message.reply(`❌ **Usage:** \`${prefix}ri del [inventory id/number]\``);
      }

      let targetInv = await Inventory.findOne({ guildId: message.guild.id, userId: targetUser.id });
      if (!targetInv || !targetInv.roles || targetInv.roles.length === 0) {
        return message.reply(`📭 ${targetUser.id === message.author.id ? 'Your' : `${targetUser.username}'s`} inventory is empty.`);
      }

      const index = parseInt(indexInput);
      if (isNaN(index) || index < 1 || index > targetInv.roles.length) {
        return message.reply(`❌ **Invalid Inventory Number:** Please specify a number between 1 and ${targetInv.roles.length}.`);
      }

      const item = targetInv.roles[index - 1];

      // If the role is currently equipped, strip it from Discord first!
      if (item.isUsed) {
        const wearerId = item.assignedTo;
        const wearerMember = await message.guild.members.fetch(wearerId).catch(() => null);
        if (wearerMember) {
          const discordRole = await message.guild.roles.fetch(item.roleId).catch(() => null);
          if (discordRole) {
            try {
              await wearerMember.roles.remove(discordRole);
            } catch (err) {
              console.error('[Discard Discord Error]', err);
            }
          }
        }
      }

      // Remove from inventory array
      const discardedName = item.name;
      targetInv.roles.splice(index - 1, 1);
      await targetInv.save();

      return message.reply(`🗑️ **Item Discarded:** Successfully removed **${discardedName}** (Item #${index}) from ${targetUser.id === message.author.id ? 'your' : `${targetUser.username}'s`} inventory.`);
    }

    // --- VIEW INVENTORY ---
    let targetUser = message.author;
    if (firstArg) {
      const cleanId = firstArg.replace(/[<@!>]/g, '');
      const member = await message.guild.members.fetch(cleanId).catch(() => null);
      if (member) {
        if (!isAdmin) {
          return message.reply("❌ Only administrators can view other users' inventories.");
        }
        targetUser = member.user;
      }
    }

    let inv = await Inventory.findOne({ guildId: message.guild.id, userId: targetUser.id });

    // Query active roles equipped on this user by other guild members
    const activeGifted = await Inventory.find({
      guildId: message.guild.id,
      userId: { $ne: targetUser.id },
      "roles": { $elemMatch: { isUsed: true, assignedTo: targetUser.id } }
    });

    const giftedRoles = [];
    for (const otherInv of activeGifted) {
      for (const r of otherInv.roles) {
        if (r.isUsed && r.assignedTo === targetUser.id) {
          giftedRoles.push({
            name: r.name,
            giftedBy: otherInv.userId,
            isTemporary: r.isTemporary,
            expiresAt: r.expiresAt
          });
        }
      }
    }

    const ownRolesCount = inv?.roles?.length || 0;
    const hasOwnItems = ownRolesCount > 0;
    const hasGiftedItems = giftedRoles.length > 0;

    if (!hasOwnItems && !hasGiftedItems) {
      if (targetUser.id === message.author.id) {
        return message.reply(`📭 Your inventory is currently empty! Use \`${prefix}br list\` to browse available roles.`);
      } else {
        return message.reply(`📭 **${targetUser.username}**'s inventory is currently empty!`);
      }
    }

    let pageIndex = 0;
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(ownRolesCount / pageSize));

    const generateInventoryPage = (index) => {
      const start = index * pageSize;
      const pageItems = inv ? inv.roles.slice(start, start + pageSize) : [];

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📦 ${targetUser.username}'s Role Inventory`)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: `Page ${index + 1} of ${totalPages}` });

      let descriptionText = "────────────────────────────────────────\n";
      
      // 1. Render Gifted Items First (if any)
      if (giftedRoles.length > 0) {
        descriptionText += `Total gift items: ${giftedRoles.length}\n────────────────────────────────────────\n`;
        descriptionText += `🎁 **Active Roles Equipped on You by Others**\n`;
        giftedRoles.forEach((gr, idx) => {
          let tempText = '♾️ Permanent';
          if (gr.isTemporary) {
            const timeRemaining = gr.expiresAt ? Math.max(0, gr.expiresAt.getTime() - Date.now()) : 0;
            tempText = `⏳ Temp (Expires: <t:${Math.floor(gr.expiresAt.getTime() / 1000)}:R> | ${formatPreciseDuration(timeRemaining)})`;
          }
          descriptionText += `**[ Gift #${idx + 1} ] ${gr.name}**\n`;
          descriptionText += `*Equipped by: <@${gr.giftedBy}> | Type: ${tempText}*\n`;
          descriptionText += `────────────────────────────────────────\n`;
        });
      }

      // 2. Render Own Items
      if (ownRolesCount > 0) {
        descriptionText += `Total owned items: ${ownRolesCount}\n────────────────────────────────────────\n`;
        pageItems.forEach((item, pageIdx) => {
          const itemNumber = start + pageIdx + 1;
          const purchaseDate = new Date(item.purchasedAt).toLocaleDateString();
          
          let typeTag = "";
          let statusTag = "";

          if (item.isTemporary) {
            typeTag = `⏳ Temp (${formatDuration(item.durationMs)})`;
            if (item.isUsed) {
              const timeRemaining = item.expiresAt ? Math.max(0, item.expiresAt.getTime() - Date.now()) : 0;
              statusTag = `✅ Equipped on ${item.assignedTo === targetUser.id ? 'Self' : `<@${item.assignedTo}>`} (<t:${Math.floor(item.expiresAt.getTime() / 1000)}:R> remaining | ${formatPreciseDuration(timeRemaining)})`;
            } else {
              statusTag = `💤 Dormant in Inventory`;
            }
          } else {
            typeTag = `♾️ Permanent`;
            if (item.isUsed) {
              statusTag = `✅ Equipped on ${item.assignedTo === targetUser.id ? 'Self' : `<@${item.assignedTo}>`}`;
            } else {
              statusTag = `📦 Unused in Inventory`;
            }
          }

          descriptionText += `**[ ${itemNumber} ] ${item.name}**\n`;
          descriptionText += `*Type: ${typeTag} | Status: ${statusTag} | Bought: ${purchaseDate}*\n`;
          descriptionText += `────────────────────────────────────────\n`;
        });
      } else {
        descriptionText += `*This user does not currently own any items in their inventory.*\n────────────────────────────────────────\n`;
      }

      descriptionText += `**CMDS:**\n`;
      descriptionText += `- \`${prefix}userole [inv id/num]\` - Equip\n`;
      descriptionText += `- \`${prefix}ur [inv id/num] @MentionFriend\` - Gift a friend\n`;
      descriptionText += `- \`${prefix}ur unequip [inv id/num]\` - Unequip\n`;
      descriptionText += `- \`${prefix}inv del [inv id/num]\`  - Delete\n`;
      if (isAdmin) {
        descriptionText += `- \`${prefix}inv del @user [inv id/num]\` - Admin Delete\n`;
        descriptionText += `- \`${prefix}inv wipe @user\` - Admin Wipe User Inventory\n`;
      }

      embed.setDescription(descriptionText);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('inv_prev')
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId('inv_next')
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index >= totalPages - 1)
      );

      return { embeds: [embed], components: totalPages > 1 ? [row] : [] };
    };

    const mainMsg = await message.reply(generateInventoryPage(pageIndex));
    if (totalPages <= 1) return;

    const collector = mainMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id) {
        return i.reply({ content: 'Only the user who ran the command can flip pages.', flags: [MessageFlags.Ephemeral] });
      }

      if (i.customId === 'inv_prev') {
        pageIndex--;
        await i.update(generateInventoryPage(pageIndex));
      }

      if (i.customId === 'inv_next') {
        pageIndex++;
        await i.update(generateInventoryPage(pageIndex));
      }
    });

    collector.on('end', () => {
      mainMsg.edit({ components: [] }).catch(() => {});
    });
  }
};
