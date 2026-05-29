const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, ComponentType, MessageFlags } = require('discord.js');
const Guild = require('../../models/Guild');
const Inventory = require('../../models/Inventory');
const axios = require('axios');
const { getEconomyToken, deductFunds, formatNumber } = require('../../utils/economy.js');

// --- Helper Functions ---
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
  name: "buyrole",
  aliases: ["br", "rb", "rolebuy"],
  description: "Purchase a role from the storefront or manage store listings (Admins).",
  usage: "br [number] / br setup / br add [@role] [price]",
  run: async (client, message, args, prefix, config) => {
    const input = args[0]?.toLowerCase();

    if (input === 'list') {
      return require('./rolestore.js').run(client, message, args.slice(1), prefix, config);
    }

    // -------------------------------------------------------------
    // --- 1. USER: PURCHASE BY STORE LIST INDEX ---
    // -------------------------------------------------------------
    const index = parseInt(input);
    if (!isNaN(index)) {
      if (!message.guild) return message.reply("❌ Purchases must be made within a server.");

      const guildData = await Guild.findOne({ guildId: message.guild.id });
      if (!guildData || !guildData.roleStore || guildData.roleStore.length === 0) {
        return message.reply("📭 The role store is currently empty. Check back later!");
      }

      // Filter out expired seasonal listings
      const now = new Date();
      const activeStore = guildData.roleStore.filter(item => !item.saleExpiresAt || item.saleExpiresAt > now);

      if (index < 1 || index > activeStore.length) {
        return message.reply(`❌ Invalid store item number. Use \`${prefix}br list\` to view available roles.`);
      }

      const item = activeStore[index - 1];

      // Check stock
      if (item.stock === 0) {
        return message.reply("❌ This role is currently out of stock!");
      }

      // Verify UnbelievaBoat key
      const token = getEconomyToken(client, message.guild.id);
      if (!token) {
        return message.reply("⚠️ **Economy Link Required!** This server has not linked an UnbelievaBoat API token yet. Admins must set one up with `r unbtoken` first.");
      }

      // Check if user already owns the role in their inventory
      let userInv = await Inventory.findOne({ guildId: message.guild.id, userId: message.author.id });
      if (userInv && userInv.roles.some(r => r.roleId === item.roleId)) {
        return message.reply("⚠️ You already have this role in your inventory!");
      }

      message.channel.sendTyping();

      try {
        // Deduct UnbelievaBoat balance
        const deduction = await deductFunds(
          client,
          message.guild.id,
          message.author.id,
          item.price,
          `Role Store Purchase: ${item.name}`
        );

        if (!deduction.success) {
          return message.reply(deduction.error);
        }

        // Add to user inventory
        if (!userInv) {
          userInv = new Inventory({ guildId: message.guild.id, userId: message.author.id, roles: [] });
        }

        userInv.roles.push({
          roleId: item.roleId,
          name: item.name,
          isTemporary: item.isTemporary,
          durationMs: item.durationMs,
          purchasedAt: new Date(),
          isUsed: false,
          assignedTo: null
        });

        await userInv.save();

        // Decrement stock if applicable
        if (item.stock > 0) {
          const originalItem = guildData.roleStore.id(item._id);
          if (originalItem) {
            originalItem.stock--;
            await guildData.save();
          }
        }

        const successEmbed = new EmbedBuilder()
          .setColor('#43B581')
          .setTitle('🛍️ Role Store Purchase Successful!')
          .setDescription(`You successfully purchased **${item.name}** for **💰 ${formatNumber(item.price)}**!`)
          .addFields(
            { name: '📦 Delivery', value: `The item has been added to your inventory. Type \`${prefix}ri\` to view it.`, inline: false },
            { name: '🏷️ Activation', value: `Use \`${prefix}ur ${item.name}\` to equip it on yourself, or \`${prefix}ur @member ${item.name}\` to gift/equip it to a friend!`, inline: false }
          )
          .setTimestamp();

        return message.reply({ embeds: [successEmbed] });

      } catch (err) {
        console.error('[Role Store Purchase Error]', err);
        return message.reply("❌ An error occurred during the transaction. Please try again later.");
      }
    }

    // -------------------------------------------------------------
    // --- 2. ADMIN COMMANDS ---
    // -------------------------------------------------------------
    const isAdmin = message.member?.permissions.has(PermissionsBitField.Flags.Administrator);

    // If no arguments, guide the user
    if (!input) {
      return message.reply(`🛍️ **Role Store**\n* Use \`${prefix}br list\` to view available roles.\n* Use \`${prefix}br [number]\` to buy.\n* Use \`${prefix}ri\` to view your inventory.`);
    }

    // Handle Admin Setup Action Commands
    if (['setup', 'add', 'remove', 'setdesc', 'setstock', 'settemp', 'setsale'].includes(input)) {
      if (!isAdmin) return message.reply("❌ Only administrators can configure the role store.");

      let guildData = await Guild.findOne({ guildId: message.guild.id });
      if (!guildData) {
        guildData = new Guild({ guildId: message.guild.id });
      }

      // --- BR ADD ---
      if (input === 'add') {
        const roleMention = args[1];
        const priceInput = args[2];
        const descInput = args.slice(3).join(' ');

        if (!roleMention || !priceInput) {
          return message.reply(`❌ **Usage:** \`${prefix}br add [@role/RoleID] [price] [optional description]\``);
        }

        const roleId = roleMention.replace(/[<@&>]/g, '');
        const role = await message.guild.roles.fetch(roleId).catch(() => null);
        if (!role) return message.reply("❌ Invalid role provided.");

        const price = parseInt(priceInput);
        if (isNaN(price) || price < 0) return message.reply("❌ Price must be a valid positive number.");

        // Check if role is already in store
        if (guildData.roleStore.some(item => item.roleId === role.id)) {
          return message.reply("⚠️ This role is already listed in the storefront!");
        }

        guildData.roleStore.push({
          roleId: role.id,
          name: role.name,
          price: price,
          description: descInput || "No description provided."
        });

        await guildData.save();
        return message.reply(`✅ Listed **${role.name}** in the storefront for **💰 ${formatNumber(price)}**!`);
      }

      // --- BR REMOVE ---
      if (input === 'remove') {
        const roleMention = args[1];
        if (!roleMention) return message.reply(`❌ **Usage:** \`${prefix}br remove [@role/RoleID]\``);

        const roleId = roleMention.replace(/[<@&>]/g, '');
        const indexToRemove = guildData.roleStore.findIndex(item => item.roleId === roleId);

        if (indexToRemove === -1) {
          return message.reply("❌ This role is not listed in the storefront.");
        }

        const roleName = guildData.roleStore[indexToRemove].name;
        guildData.roleStore.splice(indexToRemove, 1);
        await guildData.save();

        return message.reply(`✅ Removed **${roleName}** from the storefront.`);
      }

      // --- BR SETDESC ---
      if (input === 'setdesc') {
        const roleMention = args[1];
        const descInput = args.slice(2).join(' ');

        if (!roleMention || !descInput) {
          return message.reply(`❌ **Usage:** \`${prefix}br setdesc [@role/RoleID] [description]\``);
        }

        const roleId = roleMention.replace(/[<@&>]/g, '');
        const item = guildData.roleStore.find(item => item.roleId === roleId);
        if (!item) return message.reply("❌ That role is not in the store.");

        item.description = descInput;
        await guildData.save();
        return message.reply(`✅ Description updated for **${item.name}**.`);
      }

      // --- BR SETSTOCK ---
      if (input === 'setstock') {
        const roleMention = args[1];
        const stockInput = args[2];

        if (!roleMention || !stockInput) {
          return message.reply(`❌ **Usage:** \`${prefix}br setstock [@role/RoleID] [limit/-1 for unlimited]\``);
        }

        const roleId = roleMention.replace(/[<@&>]/g, '');
        const item = guildData.roleStore.find(item => item.roleId === roleId);
        if (!item) return message.reply("❌ That role is not in the store.");

        const stock = parseInt(stockInput);
        if (isNaN(stock) || stock < -1) return message.reply("❌ Stock limit must be -1 (unlimited) or a positive integer.");

        item.stock = stock;
        await guildData.save();
        return message.reply(`✅ Stock limit for **${item.name}** set to **${stock === -1 ? 'Unlimited' : stock}**.`);
      }

      // --- BR SETTEMP ---
      if (input === 'settemp') {
        const roleMention = args[1];
        const tempInput = args[2];

        if (!roleMention || !tempInput) {
          return message.reply(`❌ **Usage:** \`${prefix}br settemp [@role/RoleID] [duration e.g. 7d, 12h, 30m / 0 for permanent]\``);
        }

        const roleId = roleMention.replace(/[<@&>]/g, '');
        const item = guildData.roleStore.find(item => item.roleId === roleId);
        if (!item) return message.reply("❌ That role is not in the store.");

        if (tempInput === '0') {
          item.isTemporary = false;
          item.durationMs = 0;
          await guildData.save();
          return message.reply(`✅ **${item.name}** is now a **Permanent** role.`);
        }

        const durationMs = parseDuration(tempInput);
        if (durationMs <= 0) {
          return message.reply("❌ Invalid duration. Use formatting like `7d` (days), `12h` (hours), or `30m` (minutes).");
        }

        item.isTemporary = true;
        item.durationMs = durationMs;
        await guildData.save();
        return message.reply(`✅ **${item.name}** set as a temporary role with a **${formatDuration(durationMs)}** duration.`);
      }

      // --- BR SETSALE ---
      if (input === 'setsale') {
        const roleMention = args[1];
        const saleInput = args[2];

        if (!roleMention || !saleInput) {
          return message.reply(`❌ **Usage:** \`${prefix}br setsale [@role/RoleID] [duration e.g. 3d, 24h / 0 to disable]\``);
        }

        const roleId = roleMention.replace(/[<@&>]/g, '');
        const item = guildData.roleStore.find(item => item.roleId === roleId);
        if (!item) return message.reply("❌ That role is not in the store.");

        if (saleInput === '0') {
          item.saleExpiresAt = null;
          await guildData.save();
          return message.reply(`✅ Seasonal sale limit disabled for **${item.name}**.`);
        }

        const durationMs = parseDuration(saleInput);
        if (durationMs <= 0) {
          return message.reply("❌ Invalid duration. Use formatting like `3d` (days) or `24h` (hours).");
        }

        item.saleExpiresAt = new Date(Date.now() + durationMs);
        await guildData.save();
        return message.reply(`✅ **${item.name}** will be listed on sale until **${item.saleExpiresAt.toLocaleString()}**.`);
      }

      // --- BR SETUP (INTERACTIVE DASHBOARD) ---
      if (input === 'setup') {
        return startInteractiveSetup(client, message, guildData);
      }
    }

    return message.reply(`🛍️ **Role Store**\n* Use \`${prefix}br list\` to view available roles.\n* Use \`${prefix}br [number]\` to buy.\n* Use \`${prefix}ri\` to view inventory.`);
  }
};

// --- Interactive Admin Dashboard Engine ---
async function startInteractiveSetup(client, message, guildData) {
  const prefix = guildData.prefix || 'r';

  const generateEmbed = (data) => {
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('⚙️ Role Store Dashboard')
      .setDescription(`Use the buttons below to configure the roles store.\nAdmins can also use direct commands (e.g. \`${prefix}br add @Role 5000\`).`)
      .setTimestamp();

    if (!data.roleStore || data.roleStore.length === 0) {
      embed.addFields({ name: '🏪 Store Listings', value: '❌ *No roles configured yet.*', inline: false });
    } else {
      let activeList = "";
      data.roleStore.forEach((item, idx) => {
        const tempTag = item.isTemporary ? `⏳ Temp (${formatDuration(item.durationMs)})` : '♾️ Permanent';
        const stockTag = item.stock === -1 ? '∞' : `${item.stock}`;
        const saleTag = item.saleExpiresAt ? ` | 🍂 Sale ends: <t:${Math.floor(item.saleExpiresAt.getTime() / 1000)}:R>` : '';

        activeList += `**${idx + 1}.** <@&${item.roleId}> — **💰 ${formatNumber(item.price)}** [${tempTag} | Stock: ${stockTag}${saleTag}]\n*${item.description}*\n\n`;
      });
      embed.addFields({ name: '🏪 Active Store Listings', value: activeList });
    }

    return embed;
  };

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rs_add').setLabel('Add Role').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('rs_remove').setLabel('Remove Role').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('rs_close').setLabel('Close Setup').setStyle(ButtonStyle.Secondary)
  );

  const setupMsg = await message.reply({ embeds: [generateEmbed(guildData)], components: [row] });
  const collector = setupMsg.createMessageComponentCollector({ time: 600000 });

  collector.on('collect', async (i) => {
    if (i.user.id !== message.author.id) {
      return i.reply({ content: '❌ Only the administrator who opened this setup can interact.', flags: [MessageFlags.Ephemeral] });
    }

    if (i.customId === 'rs_close') {
      collector.stop();
      return i.update({ content: '✅ Setup dashboard closed.', embeds: [], components: [] });
    }

    // ADD ROLE DIALOGUE (Modal based)
    if (i.customId === 'rs_add') {
      const modal = new ModalBuilder()
        .setCustomId('rs_add_modal')
        .setTitle('Add Role to Storefront');

      const roleInput = new TextInputBuilder()
        .setCustomId('rs_role_id')
        .setLabel('Role ID or exact Role Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter Role ID...')
        .setRequired(true);

      const priceInput = new TextInputBuilder()
        .setCustomId('rs_price')
        .setLabel('Store Price (Coins)')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('e.g. 5000')
        .setRequired(true);

      const descInput = new TextInputBuilder()
        .setCustomId('rs_desc')
        .setLabel('Store Description')
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder('Details about the role perks...')
        .setRequired(false);

      modal.addComponents(
        new ActionRowBuilder().addComponents(roleInput),
        new ActionRowBuilder().addComponents(priceInput),
        new ActionRowBuilder().addComponents(descInput)
      );

      await i.showModal(modal);

      try {
        const submitted = await i.awaitModalSubmit({
          time: 60000,
          filter: mi => mi.customId === 'rs_add_modal' && mi.user.id === i.user.id,
        });

        if (submitted) {
          const roleVal = submitted.fields.getTextInputValue('rs_role_id').trim();
          const priceVal = parseInt(submitted.fields.getTextInputValue('rs_price').trim());
          const descVal = submitted.fields.getTextInputValue('rs_desc').trim();

          const role = await message.guild.roles.fetch(roleVal).catch(() => null) ||
                       message.guild.roles.cache.find(r => r.name.toLowerCase() === roleVal.toLowerCase());

          if (!role) {
            return submitted.reply({ content: "❌ Role not found. Please provide a valid Role ID or exact name.", flags: [MessageFlags.Ephemeral] });
          }

          if (isNaN(priceVal) || priceVal < 0) {
            return submitted.reply({ content: "❌ Price must be a positive number.", flags: [MessageFlags.Ephemeral] });
          }

          const freshGuild = await Guild.findOne({ guildId: message.guild.id }) || new Guild({ guildId: message.guild.id });
          if (freshGuild.roleStore.some(item => item.roleId === role.id)) {
            return submitted.reply({ content: "⚠️ This role is already listed in the store!", flags: [MessageFlags.Ephemeral] });
          }

          freshGuild.roleStore.push({
            roleId: role.id,
            name: role.name,
            price: priceVal,
            description: descVal || "No description provided."
          });

          await freshGuild.save();
          await submitted.update({ embeds: [generateEmbed(freshGuild)] });
        }
      } catch (err) {
        // Timeout
      }
    }

    // REMOVE ROLE DIALOGUE (Modal based)
    if (i.customId === 'rs_remove') {
      const modal = new ModalBuilder()
        .setCustomId('rs_rem_modal')
        .setTitle('Remove Role from Storefront');

      const roleInput = new TextInputBuilder()
        .setCustomId('rs_role_id')
        .setLabel('Role ID, Mention, or Exact Name')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter Role ID to remove...')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(roleInput));
      await i.showModal(modal);

      try {
        const submitted = await i.awaitModalSubmit({
          time: 60000,
          filter: mi => mi.customId === 'rs_rem_modal' && mi.user.id === i.user.id,
        });

        if (submitted) {
          const roleVal = submitted.fields.getTextInputValue('rs_role_id').replace(/[<@&>]/g, '').trim();

          const freshGuild = await Guild.findOne({ guildId: message.guild.id });
          if (!freshGuild || !freshGuild.roleStore) {
            return submitted.reply({ content: "❌ Store is empty.", flags: [MessageFlags.Ephemeral] });
          }

          const indexToRemove = freshGuild.roleStore.findIndex(item => 
            item.roleId === roleVal || item.name.toLowerCase() === roleVal.toLowerCase()
          );

          if (indexToRemove === -1) {
            return submitted.reply({ content: "❌ That role is not in the store.", flags: [MessageFlags.Ephemeral] });
          }

          freshGuild.roleStore.splice(indexToRemove, 1);
          await freshGuild.save();
          await submitted.update({ embeds: [generateEmbed(freshGuild)] });
        }
      } catch (err) {
        // Timeout
      }
    }
  });

  collector.on('end', () => {
    setupMsg.edit({ components: [] }).catch(() => {});
  });
}
