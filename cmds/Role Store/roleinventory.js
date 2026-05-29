const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
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
  aliases: ["i", "inv", "ri", "inventory", "myroles"],
  description: "View your purchased role inventory, showing active wearers and timers.",
  usage: "ri",
  run: async (client, message, args, prefix, config) => {
    if (!message.guild) return message.reply("❌ Inventories can only be viewed within a server.");

    let inv = await Inventory.findOne({ guildId: message.guild.id, userId: message.author.id });

    const firstArg = args[0]?.toLowerCase();
    if (firstArg === 'discard' || firstArg === 'remove' || firstArg === 'delete') {
      const indexInput = args[1];
      if (!indexInput) {
        return message.reply(`❌ **Usage:** \`${prefix}ri discard [inventory id/number]\``);
      }

      if (!inv || !inv.roles || inv.roles.length === 0) {
        return message.reply("📭 Your inventory is empty.");
      }

      const index = parseInt(indexInput);
      if (isNaN(index) || index < 1 || index > inv.roles.length) {
        return message.reply(`❌ **Invalid Inventory Number:** Please specify a number between 1 and ${inv.roles.length}.`);
      }

      const item = inv.roles[index - 1];

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
      inv.roles.splice(index - 1, 1);
      await inv.save();

      return message.reply(`🗑️ **Item Discarded:** Successfully removed **${discardedName}** (Item #${index}) from your inventory.`);
    }

    // Query active roles equipped on this user by other guild members
    const activeGifted = await Inventory.find({
      guildId: message.guild.id,
      userId: { $ne: message.author.id },
      "roles": { $elemMatch: { isUsed: true, assignedTo: message.author.id } }
    });

    const giftedRoles = [];
    for (const otherInv of activeGifted) {
      for (const r of otherInv.roles) {
        if (r.isUsed && r.assignedTo === message.author.id) {
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
      return message.reply(`📭 Your inventory is currently empty! Use \`${prefix}br list\` to browse available roles.`);
    }

    let pageIndex = 0;
    const pageSize = 10;
    const totalPages = Math.max(1, Math.ceil(ownRolesCount / pageSize));

    const generateInventoryPage = (index) => {
      const start = index * pageSize;
      const pageItems = inv ? inv.roles.slice(start, start + pageSize) : [];

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📦 ${message.author.username}'s Role Inventory`)
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: `Page ${index + 1} of ${totalPages}` });

      let descriptionText = `Manage your items here.\n`;
      if (ownRolesCount > 0) {
        descriptionText += `* Use \`${prefix}ur [inventory id/number]\` to equip a role on yourself.*\n* Use \`${prefix}ur [inventory id/number] @member\` to gift and equip it on a friend.*\n* Use \`${prefix}ur unequip [inventory id/number]\` to return an active role to inventory.*\n* Use \`${prefix}ri discard [inventory id/number]\` to permanently delete an item.*\n\n*Total items: ${ownRolesCount}*\n────────────────────────────────────────\n\n`;
      } else {
        descriptionText += `*You do not currently own any items in your inventory. Use \`${prefix}br list\` to buy roles!*\n\n`;
      }

      // 1. Render Gifted Items First (if any)
      if (giftedRoles.length > 0) {
        descriptionText += `**🎁 Active Roles Equipped on You by Others**\n`;
        giftedRoles.forEach((gr, idx) => {
          let tempText = '♾️ Permanent';
          if (gr.isTemporary) {
            const timeRemaining = gr.expiresAt ? Math.max(0, gr.expiresAt.getTime() - Date.now()) : 0;
            tempText = `⏳ Temp (Expires: <t:${Math.floor(gr.expiresAt.getTime() / 1000)}:R> | ${formatPreciseDuration(timeRemaining)})`;
          }
          descriptionText += `**[ Gift #${idx + 1} ]  ${gr.name}**\n`;
          descriptionText += `*Equipped by: <@${gr.giftedBy}>  |  Type: ${tempText}*\n`;
          if (idx < giftedRoles.length - 1 || ownRolesCount > 0) {
            descriptionText += `────────────────────────────────────────\n`;
          } else {
            descriptionText += `\n`;
          }
        });
      }

      // 2. Render Own Items
      pageItems.forEach((item, pageIdx) => {
        const itemNumber = start + pageIdx + 1;
        const purchaseDate = new Date(item.purchasedAt).toLocaleDateString();
        
        let typeTag = "";
        let statusTag = "";

        if (item.isTemporary) {
          typeTag = `⏳ Temp (${formatDuration(item.durationMs)})`;
          if (item.isUsed) {
            const timeRemaining = item.expiresAt ? Math.max(0, item.expiresAt.getTime() - Date.now()) : 0;
            statusTag = `✅ Equipped on ${item.assignedTo === message.author.id ? 'Self' : `<@${item.assignedTo}>`} (<t:${Math.floor(item.expiresAt.getTime() / 1000)}:R> remaining | ${formatPreciseDuration(timeRemaining)})`;
          } else {
            statusTag = `💤 Dormant in Inventory`;
          }
        } else {
          typeTag = `♾️ Permanent`;
          if (item.isUsed) {
            statusTag = `✅ Equipped on ${item.assignedTo === message.author.id ? 'Self' : `<@${item.assignedTo}>`}`;
          } else {
            statusTag = `📦 Unused in Inventory`;
          }
        }

        descriptionText += `**[ ${itemNumber} ]  ${item.name}**\n`;
        descriptionText += `*Type: ${typeTag}  |  Status: ${statusTag}  |  Bought: ${purchaseDate}*\n`;
        if (pageIdx < pageItems.length - 1) {
          descriptionText += `────────────────────────────────────────\n`;
        } else {
          descriptionText += `\n`;
        }
      });

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
        return i.reply({ content: 'Only the user whose inventory this is can flip pages.', flags: [MessageFlags.Ephemeral] });
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
