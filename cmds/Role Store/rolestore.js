const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } = require('discord.js');
const Guild = require('../../models/Guild');
const Inventory = require('../../models/Inventory');
const { formatNumber, getEconomyToken, deductFunds } = require('../../utils/economy.js');

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
    const generateStorePage = (index, storeList = activeStore) => {
      const start = index * pageSize;
      const pageItems = storeList.slice(start, start + pageSize);

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🏪 Server Role Storefront')
        .setThumbnail(message.guild.iconURL({ dynamic: true }))
        .setTimestamp()
        .setFooter({ text: `Page ${index + 1} of ${totalPages} | Real-time buy buttons active` });

      let descriptionText = `Click a button below to instantly buy an item, or use the \`${prefix}br [number]\` command to purchase.\n\n`;

      pageItems.forEach((item, pageIdx) => {
        const itemNumber = start + pageIdx + 1;
        
        let priceTag = `💰 ${formatNumber(item.price)}`;
        let tempTag = 'Permanent';

        if (item.priceMode === 'RENT') {
          priceTag = `💰 ${formatNumber(item.price)} / ${formatDuration(item.durationMs)}`;
          tempTag = `Rentable`;
        } else if (item.isTemporary) {
          tempTag = `Temp (${formatDuration(item.durationMs)})`;
        }

        const stockTag = item.stock === 0 ? '❌ OUT OF STOCK' : (item.stock === -1 ? 'Unlimited' : `${item.stock} left`);
        const saleTag = item.saleExpiresAt ? ` | Sale ends: <t:${Math.floor(item.saleExpiresAt.getTime() / 1000)}:R>` : '';

        descriptionText += `**[ ${itemNumber} ]  ${item.name}**\n`;
        descriptionText += `${item.description}\n`;
        descriptionText += `*Price: ${priceTag}  |  Type: ${tempTag}  |  Stock: ${stockTag}${saleTag}*\n`;
        if (pageIdx < pageItems.length - 1) {
          descriptionText += `────────────────────────────────────────\n`;
        } else {
          descriptionText += `\n`;
        }
      });

      embed.setDescription(descriptionText);

      // Row 1: Direct Buy Buttons for page items
      const buyRow = new ActionRowBuilder();
      pageItems.forEach((item, pageIdx) => {
        const itemNumber = start + pageIdx + 1;
        buyRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`rs_buy_btn_${itemNumber}`)
            .setLabel(`Buy [${itemNumber}]`)
            .setStyle(ButtonStyle.Success)
            .setDisabled(item.stock === 0)
        );
      });

      // Row 2: Pagination Controls
      const pageRow = new ActionRowBuilder().addComponents(
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

      const components = [buyRow];
      if (totalPages > 1) {
        components.push(pageRow);
      }

      return { embeds: [embed], components: components };
    };

    const mainMsg = await message.reply(generateStorePage(pageIndex));

    const collector = mainMsg.createMessageComponentCollector({ time: 600000 });

    collector.on('collect', async (i) => {
      // --- Page Flipping (Only trigger for command author) ---
      if (i.customId === 'store_prev' || i.customId === 'store_next') {
        if (i.user.id !== message.author.id) {
          return i.reply({ content: 'Only the user who loaded the shop can flip pages.', flags: [MessageFlags.Ephemeral] });
        }

        if (i.customId === 'store_prev') {
          pageIndex--;
        } else if (i.customId === 'store_next') {
          pageIndex++;
        }

        const freshGuild = await Guild.findOne({ guildId: message.guild.id });
        const freshActiveStore = freshGuild.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);
        await i.update(generateStorePage(pageIndex, freshActiveStore));
        return;
      }

      // --- Direct Purchase Buttons (Open to anyone!) ---
      if (i.customId.startsWith('rs_buy_btn_')) {
        const btnIndex = parseInt(i.customId.split('_')[3]);
        
        await i.deferReply({ flags: [MessageFlags.Ephemeral] });

        const freshGuild = await Guild.findOne({ guildId: message.guild.id });
        const freshActiveStore = freshGuild.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);

        if (btnIndex < 1 || btnIndex > freshActiveStore.length) {
          return i.editReply({ content: "❌ Invalid storefront item number." });
        }

        const buyItem = freshActiveStore[btnIndex - 1];

        // Stock check
        if (buyItem.stock === 0) {
          return i.editReply({ content: "❌ This role is currently out of stock!" });
        }

        // Token check
        const token = getEconomyToken(client, message.guild.id);
        if (!token) {
          return i.editReply({ content: "❌ Economy configurations not found for this server." });
        }

        // Check if user already owns the role in their inventory
        let userInv = await Inventory.findOne({ guildId: message.guild.id, userId: i.user.id });
        if (userInv && userInv.roles.some(r => r.roleId === buyItem.roleId)) {
          return i.editReply({ content: "⚠️ You already have this role in your inventory!" });
        }

        // Price Mode & Calculation
        let totalPrice = buyItem.price;
        let durationMs = buyItem.durationMs;
        let isRent = buyItem.priceMode === 'RENT';

        if (isRent) {
          // If direct bought via button, default rentable to 1 rent unit purchase
          totalPrice = buyItem.price;
          durationMs = buyItem.durationMs;
        }

        // Deduct Coins
        const deduction = await deductFunds(
          client,
          message.guild.id,
          i.user.id,
          totalPrice,
          `Role Store Button Purchase: ${buyItem.name}`
        );

        if (!deduction.success) {
          return i.editReply({ content: deduction.error });
        }

        // Add to inventory
        if (!userInv) {
          userInv = new Inventory({ guildId: message.guild.id, userId: i.user.id, roles: [] });
        }

        userInv.roles.push({
          roleId: buyItem.roleId,
          name: buyItem.name,
          isTemporary: buyItem.isTemporary || isRent,
          durationMs: durationMs,
          purchasedAt: new Date(),
          isUsed: false,
          assignedTo: null
        });

        await userInv.save();

        // Decrement stock in Mongoose
        if (buyItem.stock > 0) {
          const originalItem = freshGuild.roleStore.id(buyItem._id);
          if (originalItem) {
            originalItem.stock--;
            await freshGuild.save();
          }
        }

        await i.editReply({ content: `🛍️ **Purchase Successful!** You successfully purchased **${buyItem.name}** ${isRent ? `(${formatDuration(buyItem.durationMs)})` : ''} for **💰 ${formatNumber(totalPrice)}**!\nUse \`${prefix}ur ${buyItem.name}\` to equip it on yourself.` });

        // Update the main shop page live to reflect depleted stock!
        const updatedGuild = await Guild.findOne({ guildId: message.guild.id });
        const updatedActiveStore = updatedGuild.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);
        await mainMsg.edit(generateStorePage(pageIndex, updatedActiveStore));
      }
    });

    collector.on('end', () => {
      mainMsg.edit({ components: [] }).catch(() => {});
    });
  }
};
