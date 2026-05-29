const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
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

function parseDuration(str) {
  if (!str) return 0;
  const match = str.trim().toLowerCase().match(/^(\d+)([mhd])$/);
  if (!match) return 0;
  const val = parseInt(match[1]);
  const unit = match[2];
  const multipliers = {
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };
  return val * multipliers[unit];
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

        // Token check
        const token = getEconomyToken(client, message.guild.id);
        if (!token) {
          return i.reply({ content: "❌ Economy configurations not found for this server.", flags: [MessageFlags.Ephemeral] });
        }

        const freshGuild = await Guild.findOne({ guildId: message.guild.id });
        const freshActiveStore = freshGuild.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);

        if (btnIndex < 1 || btnIndex > freshActiveStore.length) {
          return i.reply({ content: "❌ Invalid storefront item number.", flags: [MessageFlags.Ephemeral] });
        }

        const buyItem = freshActiveStore[btnIndex - 1];

        // Stock check
        if (buyItem.stock === 0) {
          return i.reply({ content: "❌ This role is currently out of stock!", flags: [MessageFlags.Ephemeral] });
        }

        const isRent = buyItem.priceMode === 'RENT';

        if (isRent) {
          const modal = new ModalBuilder()
            .setCustomId(`rs_buy_rent_modal_${i.id}`)
            .setTitle(`Rent ${buyItem.name.slice(0, 20)}`);

          const durationInput = new TextInputBuilder()
            .setCustomId('rs_buy_rent_duration')
            .setLabel(`Rent Duration (min ${formatDuration(buyItem.durationMs)}) *`)
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(`e.g. 15h, 2d, or 2 for 2x units`)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(durationInput));

          await i.showModal(modal);

          const submitted = await i.awaitModalSubmit({
            time: 60000,
            filter: mi => mi.customId === `rs_buy_rent_modal_${i.id}` && mi.user.id === i.user.id,
          }).catch(() => null);

          if (!submitted) return;

          await submitted.deferReply({ flags: [MessageFlags.Ephemeral] });

          const freshGuild2 = await Guild.findOne({ guildId: message.guild.id });
          const freshActiveStore2 = freshGuild2.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);
          const buyItem2 = freshActiveStore2[btnIndex - 1];

          // Stock check
          if (buyItem2.stock === 0) {
            return submitted.editReply({ content: "❌ This role is currently out of stock!" });
          }

          const durationVal = submitted.fields.getTextInputValue('rs_buy_rent_duration').trim();
          let customMs = parseDuration(durationVal);
          let durationMs = buyItem2.durationMs;
          let totalPrice = buyItem2.price;

          if (customMs > 0) {
            if (customMs < buyItem2.durationMs) {
              return submitted.editReply({ content: `❌ **Rent Duration Too Short:** The minimum rental duration for this role is **${formatDuration(buyItem2.durationMs)}**.\nPlease specify a duration at or above the minimum.` });
            }
            durationMs = customMs;
            totalPrice = Math.round((buyItem2.price / buyItem2.durationMs) * durationMs);
          } else {
            const multiplier = parseInt(durationVal);
            if (isNaN(multiplier) || multiplier <= 0) {
              return submitted.editReply({ content: `❌ **Invalid Rent Duration/Multiplier:** Please specify a duration like \`15h\`, \`2d\`, or an integer multiplier (e.g., \`2\` for twice the minimum duration of **${formatDuration(buyItem2.durationMs)}**).` });
            }
            durationMs = buyItem2.durationMs * multiplier;
            totalPrice = buyItem2.price * multiplier;
          }

          // Deduct Coins
          const deduction = await deductFunds(
            client,
            message.guild.id,
            submitted.user.id,
            totalPrice,
            `Role Store Button Purchase: ${buyItem2.name} (${formatDuration(durationMs)})`
          );

          if (!deduction.success) {
            return submitted.editReply({ content: deduction.error });
          }

          // Fetch user inventory
          let userInv = await Inventory.findOne({ guildId: message.guild.id, userId: submitted.user.id });
          if (!userInv) {
            userInv = new Inventory({ guildId: message.guild.id, userId: submitted.user.id, roles: [] });
          }

          userInv.roles.push({
            roleId: buyItem2.roleId,
            name: buyItem2.name,
            isTemporary: true,
            durationMs: durationMs,
            purchasedAt: new Date(),
            isUsed: false,
            assignedTo: null
          });

          await userInv.save();

          // Decrement stock
          if (buyItem2.stock > 0) {
            const originalItem = freshGuild2.roleStore.id(buyItem2._id);
            if (originalItem) {
              originalItem.stock--;
              await freshGuild2.save();
            }
          }

          await submitted.editReply({ content: `🛍️ **Purchase Successful!** You successfully rented **${buyItem2.name}** (${formatDuration(durationMs)}) for **💰 ${formatNumber(totalPrice)}**!\nUse \`${prefix}ur ${userInv.roles.length}\` to equip it on yourself.` });

          // Update main storefront message
          const updatedGuild = await Guild.findOne({ guildId: message.guild.id });
          const updatedActiveStore = updatedGuild.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);
          await mainMsg.edit(generateStorePage(pageIndex, updatedActiveStore));

        } else {
          // Standard FIXED / TEMP purchase
          await i.deferReply({ flags: [MessageFlags.Ephemeral] });

          let totalPrice = buyItem.price;
          let durationMs = buyItem.durationMs;

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

          // Fetch user inventory
          let userInv = await Inventory.findOne({ guildId: message.guild.id, userId: i.user.id });
          if (!userInv) {
            userInv = new Inventory({ guildId: message.guild.id, userId: i.user.id, roles: [] });
          }

          userInv.roles.push({
            roleId: buyItem.roleId,
            name: buyItem.name,
            isTemporary: buyItem.isTemporary,
            durationMs: durationMs,
            purchasedAt: new Date(),
            isUsed: false,
            assignedTo: null
          });

          await userInv.save();

          // Decrement stock
          if (buyItem.stock > 0) {
            const originalItem = freshGuild.roleStore.id(buyItem._id);
            if (originalItem) {
              originalItem.stock--;
              await freshGuild.save();
            }
          }

          await i.editReply({ content: `🛍️ **Purchase Successful!** You successfully purchased **${buyItem.name}** for **💰 ${formatNumber(totalPrice)}**!\nUse \`${prefix}ur ${userInv.roles.length}\` to equip it on yourself.` });

          // Update main storefront message
          const updatedGuild = await Guild.findOne({ guildId: message.guild.id });
          const updatedActiveStore = updatedGuild.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);
          await mainMsg.edit(generateStorePage(pageIndex, updatedActiveStore));
        }
      }
    });

    collector.on('end', () => {
      mainMsg.edit({ components: [] }).catch(() => {});
    });
  }
};
