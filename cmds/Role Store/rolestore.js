const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const Guild = require('../../models/Guild');
const { formatNumber } = require('../../utils/economy.js');

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
  name: "rolestore",
  aliases: ["roleshop", "rs", "roleshoplist"],
  description: "View the available roles for purchase in the storefront.",
  usage: "rolestore",
  run: async (client, message, args, prefix, config) => {
    if (!message.guild) return message.reply("❌ Shop listings can only be viewed in a server.");

    const guildData = await Guild.findOne({ guildId: message.guild.id });
    if (!guildData || !guildData.roleStore || guildData.roleStore.length === 0) {
      return message.reply("📭 The role store is currently empty. Check back later!");
    }

    const now = new Date();
    // Filter active items (seasonal check)
    const activeStore = guildData.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);

    if (activeStore.length === 0) {
      return message.reply("📭 There are no active roles on sale at this time.");
    }

    let pageIndex = 0;
    const pageSize = 5;
    const totalPages = Math.ceil(activeStore.length / pageSize);

    // --- Embed and Buttons Generator ---
    const generateStorePage = (index) => {
      const start = index * pageSize;
      const pageItems = activeStore.slice(start, start + pageSize);

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🏪 Server Role Storefront')
        .setDescription(`Browse purchaseable roles below. Buy any role using its listed number!\n*Example: \`${prefix}br 1\` to buy the first role.*\n\n*Total roles on sale: ${activeStore.length}*`)
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: `Page ${index + 1} of ${totalPages} | Shop index is live` });

      pageItems.forEach((item, pageIdx) => {
        const itemNumber = start + pageIdx + 1;
        const tempTag = item.isTemporary ? `⏳ Temp (${formatDuration(item.durationMs)})` : '♾️ Permanent';
        const stockTag = item.stock === 0 ? '❌ **OUT OF STOCK**' : (item.stock === -1 ? '∞' : `${item.stock} left`);
        const saleTag = item.saleExpiresAt ? ` | 🍂 Sale ends: <t:${Math.floor(item.saleExpiresAt.getTime() / 1000)}:R>` : '';

        const desc = `**Price:** 💰 ${formatNumber(item.price)}\n**Details:** ${item.description}\n**Type:** ${tempTag} | **Stock:** ${stockTag}${saleTag}`;
        
        embed.addFields({
          name: `🛍️ [${itemNumber}] ${item.name}`,
          value: desc,
          inline: false
        });
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId('store_prev')
          .setLabel('◀️ Previous')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index === 0),
        new ButtonBuilder()
          .setCustomId('store_next')
          .setLabel('Next ▶️')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(index >= totalPages - 1)
      );

      return { embeds: [embed], components: totalPages > 1 ? [row] : [] };
    };

    const mainMsg = await message.reply(generateStorePage(pageIndex));
    if (totalPages <= 1) return;

    const collector = mainMsg.createMessageComponentCollector({ componentType: ComponentType.Button, time: 300000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id) {
        return i.reply({ content: 'Only the user who loaded the shop can flip pages.', flags: [MessageFlags.Ephemeral] });
      }

      if (i.customId === 'store_prev') {
        pageIndex--;
        await i.update(generateStorePage(pageIndex));
      }

      if (i.customId === 'store_next') {
        pageIndex++;
        await i.update(generateStorePage(pageIndex));
      }
    });

    collector.on('end', () => {
      mainMsg.edit({ components: [] }).catch(() => {});
    });
  }
};
