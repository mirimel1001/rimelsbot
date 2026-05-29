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

module.exports = {
  name: "roleinventory",
  aliases: ["i", "inv", "ri", "inventory", "myroles"],
  description: "View your purchased role inventory, showing active wearers and timers.",
  usage: "ri",
  run: async (client, message, args, prefix, config) => {
    if (!message.guild) return message.reply("❌ Inventories can only be viewed within a server.");

    const inv = await Inventory.findOne({ guildId: message.guild.id, userId: message.author.id });
    if (!inv || !inv.roles || inv.roles.length === 0) {
      return message.reply(`📭 Your inventory is currently empty! Use \`${prefix}br list\` to browse available roles.`);
    }

    let pageIndex = 0;
    const pageSize = 5;
    const totalPages = Math.ceil(inv.roles.length / pageSize);

    const generateInventoryPage = (index) => {
      const start = index * pageSize;
      const pageItems = inv.roles.slice(start, start + pageSize);

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`📦 ${message.author.username}'s Role Inventory`)
        .setDescription(`Manage your items here.\n* Use \`${prefix}ur [inventory id/number]\` to equip a role on yourself.*\n* Use \`${prefix}ur [inventory id/number] @member\` to gift and equip it on a friend.*\n* Use \`${prefix}ur unequip [inventory id/number]\` to return an active role to inventory.*\n\n*Total items: ${inv.roles.length}*`)
        .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: `Page ${index + 1} of ${totalPages}` });

      pageItems.forEach((item, pageIdx) => {
        const itemNumber = start + pageIdx + 1;
        const purchaseDate = new Date(item.purchasedAt).toLocaleDateString();
        
        let details = `**Purchased on:** ${purchaseDate}\n`;
        
        if (item.isTemporary) {
          details += `**Type:** ⏳ Temporary (Duration: ${formatDuration(item.durationMs)})\n`;
          if (item.isUsed) {
            const timeRemaining = item.expiresAt ? Math.max(0, item.expiresAt.getTime() - Date.now()) : 0;
            details += `**Status:** ✅ Equipped on ${item.assignedTo === message.author.id ? 'Self' : `<@${item.assignedTo}>`}\n`;
            details += `**Time Remaining:** <t:${Math.floor(item.expiresAt.getTime() / 1000)}:R> (${formatDuration(timeRemaining)} remaining)\n`;
          } else {
            details += `**Status:** 💤 Dormant in Inventory (Timer starts on equip)\n`;
          }
        } else {
          details += `**Type:** ♾️ Permanent\n`;
          if (item.isUsed) {
            details += `**Status:** ✅ Equipped on ${item.assignedTo === message.author.id ? 'Self' : `<@${item.assignedTo}>`}\n`;
          } else {
            details += `**Status:** 📦 Unused in Inventory\n`;
          }
        }

        embed.addFields({
          name: `🏷️ [${itemNumber}] ${item.name}`,
          value: details,
          inline: false
        });
      });

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
