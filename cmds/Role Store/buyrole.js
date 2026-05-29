const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, PermissionsBitField, ComponentType, MessageFlags, RoleSelectMenuBuilder } = require('discord.js');
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

function findStoreItem(guildData, roleInput) {
  if (!guildData || !guildData.roleStore || guildData.roleStore.length === 0) return null;
  const parsedIndex = parseInt(roleInput);
  if (!isNaN(parsedIndex)) {
    if (parsedIndex >= 1 && parsedIndex <= guildData.roleStore.length) {
      return guildData.roleStore[parsedIndex - 1];
    }
  }
  const cleanId = roleInput.replace(/[<@&>]/g, '').trim();
  return guildData.roleStore.find(item => 
    item.roleId === cleanId || item.name.toLowerCase() === roleInput.toLowerCase().trim()
  );
}

module.exports = {
  name: "buyrole",
  aliases: ["br", "rb", "rolebuy"],
  description: "Purchase a role from the storefront or manage store listings (Admins).",
  usage: "br [number] / br setup / br add [@role] [price]",
  run: async (client, message, args, prefix, config) => {
    registerBRListener(client);
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

      // Check pricing mode and calculate price/duration
      let totalPrice = item.price;
      let durationMs = item.durationMs;
      let multiplier = 0;

      if (item.priceMode === 'RENT') {
        const multiplierInput = args[1];
        multiplier = parseInt(multiplierInput);
        if (isNaN(multiplier) || multiplier <= 0) {
          return message.reply(`❌ **Multiplier Required:** **${item.name}** is a rentable role (💰 ${formatNumber(item.price)} per ${formatDuration(item.durationMs)}).\nSpecify the number of rent units you wish to purchase!\n*Usage: \`${prefix}br ${index} [multiplier]\` (e.g. \`${prefix}br ${index} 3\` to rent for 3 units)*`);
        }
        totalPrice = item.price * multiplier;
        durationMs = item.durationMs * multiplier;
      }

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
          totalPrice,
          `Role Store Purchase: ${item.name} ${item.priceMode === 'RENT' ? `(${multiplier}x units)` : ''}`
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
          isTemporary: item.isTemporary || item.priceMode === 'RENT',
          durationMs: durationMs,
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

        const durationText = item.priceMode === 'RENT' 
          ? `Rented for **${formatDuration(durationMs)}**` 
          : (item.isTemporary ? `Temporary (${formatDuration(item.durationMs)})` : 'Permanent');

        const successEmbed = new EmbedBuilder()
          .setColor('#43B581')
          .setTitle('🛍️ Role Store Purchase Successful!')
          .setDescription(`You successfully purchased **${item.name}** ${item.priceMode === 'RENT' ? `for **${formatDuration(durationMs)}**` : ''} for a total of **💰 ${formatNumber(totalPrice)}**!`)
          .addFields(
            { name: '📦 Delivery', value: `The item has been added to your inventory. Type \`${prefix}ri\` to view it.`, inline: false },
            { name: '🏷️ Activation', value: `Use \`${prefix}ur ${item.name}\` to equip it on yourself, or \`${prefix}ur @member ${item.name}\` to gift/equip it to a friend!\n*(Role duration: **${durationText}**)*`, inline: false }
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

        if (!roleMention || !priceInput) {
          return message.reply(`❌ **Usage:** \`${prefix}br add [@role/RoleID] [price] [fixed/rent] [duration/0] [optional description]\``);
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

        let mode = 'FIXED';
        let durationMs = 0;
        let isTemporary = false;
        let descInput = args.slice(3).join(' ');

        // Check if pricing mode is specified
        const potentialMode = args[3]?.toUpperCase();
        if (potentialMode === 'FIXED' || potentialMode === 'RENT') {
          mode = potentialMode;
          const tempInput = args[4];
          if (mode === 'RENT') {
            if (tempInput && tempInput !== '0') {
              return message.reply("⚠️ **Configuration Conflict:** Rental roles automatically calculate their duration based on the days purchased. Please set the duration parameter to `0` or omit it when adding a rental role!");
            }
            isTemporary = true;
            durationMs = 24 * 60 * 60 * 1000; // 1 day base unit
            descInput = args.slice(5).join(' ');
          } else {
            if (tempInput && tempInput !== '0') {
              durationMs = parseDuration(tempInput);
              if (durationMs > 0) {
                isTemporary = true;
              }
            }
            descInput = args.slice(5).join(' ');
          }
        }

        guildData.roleStore.push({
          roleId: role.id,
          name: role.name,
          price: price,
          priceMode: mode,
          description: descInput || "No description provided.",
          isTemporary: isTemporary,
          durationMs: durationMs
        });

        await guildData.save();
        const modeText = mode === 'RENT' ? 'as a Rentable role (price per day)' : (isTemporary ? `as a Temporary role (${formatDuration(durationMs)})` : 'as a Permanent role');
        return message.reply(`✅ Listed **${role.name}** in the storefront for **💰 ${formatNumber(price)}** ${modeText}!`);
      }

      // --- BR REMOVE ---
      if (input === 'remove') {
        const roleMention = args[1];
        if (!roleMention) return message.reply(`❌ **Usage:** \`${prefix}br remove [@role/RoleID/List Number]\``);

        const targetItem = findStoreItem(guildData, roleMention);
        if (!targetItem) {
          return message.reply("❌ This role is not listed in the storefront.");
        }

        const indexToRemove = guildData.roleStore.indexOf(targetItem);
        const roleName = targetItem.name;
        guildData.roleStore.splice(indexToRemove, 1);
        await guildData.save();

        return message.reply(`✅ Removed **${roleName}** from the storefront.`);
      }

      // --- BR SETDESC ---
      if (input === 'setdesc') {
        const roleMention = args[1];
        const descInput = args.slice(2).join(' ');

        if (!roleMention || !descInput) {
          return message.reply(`❌ **Usage:** \`${prefix}br setdesc [@role/RoleID/List Number] [description]\``);
        }

        const item = findStoreItem(guildData, roleMention);
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
          return message.reply(`❌ **Usage:** \`${prefix}br setstock [@role/RoleID/List Number] [limit/-1 for unlimited]\``);
        }

        const item = findStoreItem(guildData, roleMention);
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
          return message.reply(`❌ **Usage:** \`${prefix}br settemp [@role/RoleID/List Number] [duration e.g. 7d, 12h, 30m / 0 for permanent]\``);
        }

        const item = findStoreItem(guildData, roleMention);
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
          return message.reply(`❌ **Usage:** \`${prefix}br setsale [@role/RoleID/List Number] [duration e.g. 3d, 24h / 0 to disable]\``);
        }

        const item = findStoreItem(guildData, roleMention);
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
    new ButtonBuilder().setCustomId('rs_edit').setLabel('Edit Role').setStyle(ButtonStyle.Primary),
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

    // ADD ROLE DIALOGUE (Role Select Menu)
    if (i.customId === 'rs_add') {
      const roleSelect = new RoleSelectMenuBuilder()
        .setCustomId('rs_add_role_select')
        .setPlaceholder('Select a role to add to the storefront...');

      const selectRow = new ActionRowBuilder().addComponents(roleSelect);
      await i.reply({ content: '🔍 **Choose a Role:** Select the role you wish to sell from the menu below:', components: [selectRow], flags: [MessageFlags.Ephemeral] });
    }

    // EDIT ROLE DIALOGUE (String Select Menu of existing roles)
    if (i.customId === 'rs_edit') {
      const freshGuild = await Guild.findOne({ guildId: message.guild.id }) || guildData;
      if (!freshGuild.roleStore || freshGuild.roleStore.length === 0) {
        return i.reply({ content: "❌ No roles are listed in the storefront to edit.", flags: [MessageFlags.Ephemeral] });
      }

      const { StringSelectMenuBuilder } = require('discord.js');
      const options = freshGuild.roleStore.map(item => ({
        label: item.name.slice(0, 25),
        value: item.roleId,
        description: `💰 ${item.price} (${item.priceMode}) | ${item.description.slice(0, 40)}`
      }));

      const menu = new StringSelectMenuBuilder()
        .setCustomId('rs_edit_role_select')
        .setPlaceholder('Select a role to edit...')
        .addOptions(options);

      const selectRow = new ActionRowBuilder().addComponents(menu);
      await i.reply({ content: '🔍 **Select a Role:** Choose which listed role you wish to modify from the dropdown below:', components: [selectRow], flags: [MessageFlags.Ephemeral] });
    }

    // REMOVE ROLE DIALOGUE (Modal based)
    if (i.customId === 'rs_remove') {
      const modal = new ModalBuilder()
        .setCustomId('rs_rem_modal')
        .setTitle('Remove Role from Storefront');

      const roleInput = new TextInputBuilder()
        .setCustomId('rs_role_id')
        .setLabel('Role ID, Name, or List Number')
        .setStyle(TextInputStyle.Short)
        .setPlaceholder('Enter role to remove...')
        .setRequired(true);

      modal.addComponents(new ActionRowBuilder().addComponents(roleInput));
      await i.showModal(modal);

      try {
        const submitted = await i.awaitModalSubmit({
          time: 60000,
          filter: mi => mi.customId === 'rs_rem_modal' && mi.user.id === i.user.id,
        });

        if (submitted) {
          const roleVal = submitted.fields.getTextInputValue('rs_role_id').trim();

          const freshGuild = await Guild.findOne({ guildId: message.guild.id });
          if (!freshGuild || !freshGuild.roleStore) {
            return submitted.reply({ content: "❌ Store is empty.", flags: [MessageFlags.Ephemeral] });
          }

          const targetItem = findStoreItem(freshGuild, roleVal);
          if (!targetItem) {
            return submitted.reply({ content: "❌ That role is not in the store.", flags: [MessageFlags.Ephemeral] });
          }

          const indexToRemove = freshGuild.roleStore.indexOf(targetItem);
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

function registerBRListener(client) {
  if (client.brListenerRegistered) return;
  client.brListenerRegistered = true;

  client.on('interactionCreate', async (i) => {
    if (!i.isRoleSelectMenu() && !i.isModalSubmit() && !i.isStringSelectMenu() && !i.isButton()) return;

    // --- 1. Catch Role Select Menu Submission (Setup Dashboard) ---
    if (i.isRoleSelectMenu() && i.customId === 'rs_add_role_select') {
      const roleId = i.values[0];
      const role = await i.guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        return i.reply({ content: "❌ Role not found on the server.", flags: [MessageFlags.Ephemeral] });
      }

      const guildData = await Guild.findOne({ guildId: i.guild.id }) || new Guild({ guildId: i.guild.id });
      if (guildData.roleStore.some(item => item.roleId === role.id)) {
        return i.reply({ content: "⚠️ This role is already listed in the storefront!", flags: [MessageFlags.Ephemeral] });
      }

      // Present buttons to select FIXED or RENT mode
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`rs_choose_fixed_${role.id}`)
          .setLabel('One-Time (Fixed)')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`rs_choose_rent_${role.id}`)
          .setLabel('Rentable System')
          .setStyle(ButtonStyle.Success)
      );

      return i.reply({
        content: `📋 **Select Listing Mode for ${role.name}:**\n\n* **One-Time (Fixed):** A fixed price for permanent or temporary ownership.\n* **Rentable System:** A price set per rental unit duration (e.g. per 6 hours, per 1 day). Users choose how many units to purchase.`,
        components: [row],
        flags: [MessageFlags.Ephemeral]
      });
    }

    // --- 2. Catch Choice Button Clicks (Setup Dashboard) ---
    if (i.isButton()) {
      if (i.customId.startsWith('rs_choose_fixed_')) {
        const roleId = i.customId.split('_')[3];
        const role = await i.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          return i.reply({ content: "❌ Role not found on the server.", flags: [MessageFlags.Ephemeral] });
        }

        const modal = new ModalBuilder()
          .setCustomId(`rs_add_fixed_${role.id}`)
          .setTitle(`Fixed Mode: ${role.name.slice(0, 20)}`);

        const priceInput = new TextInputBuilder()
          .setCustomId('rs_price')
          .setLabel('Store Price (Coins) *')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 5000')
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('rs_desc')
          .setLabel('Store Description')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter description/perks of this role...')
          .setRequired(false);

        const durationInput = new TextInputBuilder()
          .setCustomId('rs_duration')
          .setLabel('Duration (e.g., 7d, 24h / 0 for perm)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Enter 0 for permanent, or e.g., 7d, 24h, 30m')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(priceInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(durationInput)
        );

        await i.showModal(modal);
        return;
      }

      if (i.customId.startsWith('rs_choose_rent_')) {
        const roleId = i.customId.split('_')[3];
        const role = await i.guild.roles.fetch(roleId).catch(() => null);
        if (!role) {
          return i.reply({ content: "❌ Role not found on the server.", flags: [MessageFlags.Ephemeral] });
        }

        const modal = new ModalBuilder()
          .setCustomId(`rs_add_rent_${role.id}`)
          .setTitle(`Rentable Mode: ${role.name.slice(0, 20)}`);

        const priceInput = new TextInputBuilder()
          .setCustomId('rs_price')
          .setLabel('Price per Rent Unit *')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 500')
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('rs_desc')
          .setLabel('Store Description')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Enter description/perks of this role...')
          .setRequired(false);

        const rentUnitInput = new TextInputBuilder()
          .setCustomId('rs_rent_unit')
          .setLabel('Rent Unit Duration (min 6h, e.g. 6h, 1d) *')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g. 6h, 12h, 1d (Minimum 6 hours)')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(priceInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(rentUnitInput)
        );

        await i.showModal(modal);
        return;
      }
    }

    // --- 3. Catch Add Modal Submissions ---
    if (i.isModalSubmit() && i.customId.startsWith('rs_add_fixed_')) {
      const roleId = i.customId.split('_')[3];
      const priceVal = parseInt(i.fields.getTextInputValue('rs_price').trim());
      const descVal = i.fields.getTextInputValue('rs_desc').trim();
      const durationVal = i.fields.getTextInputValue('rs_duration').trim().toLowerCase() || '0';

      const role = await i.guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        return i.reply({ content: "❌ Role not found on the server.", flags: [MessageFlags.Ephemeral] });
      }

      if (isNaN(priceVal) || priceVal < 0) {
        return i.reply({ content: "❌ Price must be a valid positive number.", flags: [MessageFlags.Ephemeral] });
      }

      let isTemporary = false;
      let durationMs = 0;

      if (durationVal !== '0' && durationVal !== '') {
        durationMs = parseDuration(durationVal);
        if (durationMs <= 0) {
          return i.reply({ content: "❌ **Invalid Duration Format!** Please specify a duration like `7d` (days), `24h` (hours), or `30m` (minutes), or enter `0` for permanent.", flags: [MessageFlags.Ephemeral] });
        }
        isTemporary = true;
      }

      const freshGuild = await Guild.findOne({ guildId: i.guild.id }) || new Guild({ guildId: i.guild.id });
      if (freshGuild.roleStore.some(item => item.roleId === role.id)) {
        return i.reply({ content: "⚠️ This role is already listed in the store!", flags: [MessageFlags.Ephemeral] });
      }

      freshGuild.roleStore.push({
        roleId: role.id,
        name: role.name,
        price: priceVal,
        priceMode: 'FIXED',
        description: descVal || "No description provided.",
        isTemporary: isTemporary,
        durationMs: durationMs
      });

      await freshGuild.save();
      const durationText = isTemporary ? `⏳ **Temporary (${formatDuration(durationMs)})**` : '♾️ **Permanent**';
      return i.reply({ content: `✅ Successfully listed **${role.name}** in the storefront for **💰 ${priceVal.toLocaleString()}**!\n* **Type:** ${durationText}\n\n*Please re-open the setup dashboard to refresh the active listings table.*`, flags: [MessageFlags.Ephemeral] });
    }

    if (i.isModalSubmit() && i.customId.startsWith('rs_add_rent_')) {
      const roleId = i.customId.split('_')[3];
      const priceVal = parseInt(i.fields.getTextInputValue('rs_price').trim());
      const descVal = i.fields.getTextInputValue('rs_desc').trim();
      const rentUnitVal = i.fields.getTextInputValue('rs_rent_unit').trim().toLowerCase();

      const role = await i.guild.roles.fetch(roleId).catch(() => null);
      if (!role) {
        return i.reply({ content: "❌ Role not found on the server.", flags: [MessageFlags.Ephemeral] });
      }

      if (isNaN(priceVal) || priceVal < 0) {
        return i.reply({ content: "❌ Price must be a valid positive number.", flags: [MessageFlags.Ephemeral] });
      }

      const durationMs = parseDuration(rentUnitVal);
      if (durationMs <= 0) {
        return i.reply({ content: "❌ **Invalid Duration Format!** Please specify a duration like `6h` (hours) or `1d` (days).", flags: [MessageFlags.Ephemeral] });
      }

      if (durationMs < 6 * 60 * 60 * 1000) {
        return i.reply({ content: "❌ **Minimum Rent Limit Alert!** Rent unit duration cannot be set below **6 hours** (e.g. `6h`).", flags: [MessageFlags.Ephemeral] });
      }

      const freshGuild = await Guild.findOne({ guildId: i.guild.id }) || new Guild({ guildId: i.guild.id });
      if (freshGuild.roleStore.some(item => item.roleId === role.id)) {
        return i.reply({ content: "⚠️ This role is already listed in the store!", flags: [MessageFlags.Ephemeral] });
      }

      freshGuild.roleStore.push({
        roleId: role.id,
        name: role.name,
        price: priceVal,
        priceMode: 'RENT',
        description: descVal || "No description provided.",
        isTemporary: true,
        durationMs: durationMs
      });

      await freshGuild.save();
      return i.reply({ content: `✅ Successfully listed **${role.name}** in the storefront for **💰 ${priceVal.toLocaleString()}** per **${formatDuration(durationMs)}**!\n* **Type:** 🔑 **Rentable**\n\n*Please re-open the setup dashboard to refresh the active listings table.*`, flags: [MessageFlags.Ephemeral] });
    }

    // --- 4. Catch Role Edit Select Menu Submission ---
    if (i.isStringSelectMenu() && i.customId === 'rs_edit_role_select') {
      const roleId = i.values[0];
      const guildData = await Guild.findOne({ guildId: i.guild.id });
      if (!guildData || !guildData.roleStore) {
        return i.reply({ content: "❌ Store settings not found.", flags: [MessageFlags.Ephemeral] });
      }

      const item = guildData.roleStore.find(si => si.roleId === roleId);
      if (!item) {
        return i.reply({ content: "❌ Role not found in storefront.", flags: [MessageFlags.Ephemeral] });
      }

      // Present custom Modal based on pricing mode
      if (item.priceMode === 'RENT') {
        const modal = new ModalBuilder()
          .setCustomId(`rs_edit_rent_${item.roleId}`)
          .setTitle(`Edit Rentable: ${item.name.slice(0, 20)}`);

        const priceInput = new TextInputBuilder()
          .setCustomId('rs_price')
          .setLabel('Price per Rent Unit *')
          .setStyle(TextInputStyle.Short)
          .setValue(item.price.toString())
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('rs_desc')
          .setLabel('Store Description')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(item.description || '')
          .setRequired(false);

        const rentUnitInput = new TextInputBuilder()
          .setCustomId('rs_rent_unit')
          .setLabel('Rent Unit Duration (min 6h, e.g. 6h, 1d) *')
          .setStyle(TextInputStyle.Short)
          .setValue(formatDuration(item.durationMs))
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(priceInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(rentUnitInput)
        );

        await i.showModal(modal);
      } else {
        const modal = new ModalBuilder()
          .setCustomId(`rs_edit_fixed_${item.roleId}`)
          .setTitle(`Edit Fixed: ${item.name.slice(0, 20)}`);

        const priceInput = new TextInputBuilder()
          .setCustomId('rs_price')
          .setLabel('Store Price (Coins) *')
          .setStyle(TextInputStyle.Short)
          .setValue(item.price.toString())
          .setRequired(true);

        const descInput = new TextInputBuilder()
          .setCustomId('rs_desc')
          .setLabel('Store Description')
          .setStyle(TextInputStyle.Paragraph)
          .setValue(item.description || '')
          .setRequired(false);

        const durationInput = new TextInputBuilder()
          .setCustomId('rs_duration')
          .setLabel('Duration (e.g., 7d, 24h / 0 for perm)')
          .setStyle(TextInputStyle.Short)
          .setValue(item.isTemporary ? formatDuration(item.durationMs) : '0')
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder().addComponents(priceInput),
          new ActionRowBuilder().addComponents(descInput),
          new ActionRowBuilder().addComponents(durationInput)
        );

        await i.showModal(modal);
      }
    }

    // --- 5. Catch Edit Modal Submissions ---
    if (i.isModalSubmit() && i.customId.startsWith('rs_edit_fixed_')) {
      const roleId = i.customId.split('_')[3];
      const priceVal = parseInt(i.fields.getTextInputValue('rs_price').trim());
      const descVal = i.fields.getTextInputValue('rs_desc').trim();
      const durationVal = i.fields.getTextInputValue('rs_duration').trim().toLowerCase() || '0';

      if (isNaN(priceVal) || priceVal < 0) {
        return i.reply({ content: "❌ Price must be a valid positive number.", flags: [MessageFlags.Ephemeral] });
      }

      let isTemporary = false;
      let durationMs = 0;

      if (durationVal !== '0' && durationVal !== '') {
        durationMs = parseDuration(durationVal);
        if (durationMs <= 0) {
          return i.reply({ content: "❌ **Invalid Duration Format!** Please specify a duration like `7d` (days), `24h` (hours), or `30m` (minutes), or enter `0` for permanent.", flags: [MessageFlags.Ephemeral] });
        }
        isTemporary = true;
      }

      const freshGuild = await Guild.findOne({ guildId: i.guild.id });
      if (!freshGuild) {
        return i.reply({ content: "❌ Store settings not found.", flags: [MessageFlags.Ephemeral] });
      }

      const item = freshGuild.roleStore.find(si => si.roleId === roleId);
      if (!item) {
        return i.reply({ content: "❌ Role not found in storefront.", flags: [MessageFlags.Ephemeral] });
      }

      // Update values
      item.price = priceVal;
      item.description = descVal || "No description provided.";
      item.isTemporary = isTemporary;
      item.durationMs = durationMs;

      await freshGuild.save();
      const durationText = isTemporary ? `⏳ **Temporary (${formatDuration(durationMs)})**` : '♾️ **Permanent**';
      return i.reply({ content: `✅ Successfully updated **${item.name}** in the storefront!\n* **Price:** 💰 ${priceVal.toLocaleString()}\n* **Type:** ${durationText}\n\n*Please re-open the setup dashboard to refresh the active listings table.*`, flags: [MessageFlags.Ephemeral] });
    }

    if (i.isModalSubmit() && i.customId.startsWith('rs_edit_rent_')) {
      const roleId = i.customId.split('_')[3];
      const priceVal = parseInt(i.fields.getTextInputValue('rs_price').trim());
      const descVal = i.fields.getTextInputValue('rs_desc').trim();
      const rentUnitVal = i.fields.getTextInputValue('rs_rent_unit').trim().toLowerCase();

      if (isNaN(priceVal) || priceVal < 0) {
        return i.reply({ content: "❌ Price must be a valid positive number.", flags: [MessageFlags.Ephemeral] });
      }

      const durationMs = parseDuration(rentUnitVal);
      if (durationMs <= 0) {
        return i.reply({ content: "❌ **Invalid Duration Format!** Please specify a duration like `6h` (hours) or `1d` (days).", flags: [MessageFlags.Ephemeral] });
      }

      if (durationMs < 6 * 60 * 60 * 1000) {
        return i.reply({ content: "❌ **Minimum Rent Limit Alert!** Rent unit duration cannot be set below **6 hours** (e.g. `6h`).", flags: [MessageFlags.Ephemeral] });
      }

      const freshGuild = await Guild.findOne({ guildId: i.guild.id });
      if (!freshGuild) {
        return i.reply({ content: "❌ Store settings not found.", flags: [MessageFlags.Ephemeral] });
      }

      const item = freshGuild.roleStore.find(si => si.roleId === roleId);
      if (!item) {
        return i.reply({ content: "❌ Role not found in storefront.", flags: [MessageFlags.Ephemeral] });
      }

      // Update values
      item.price = priceVal;
      item.description = descVal || "No description provided.";
      item.isTemporary = true;
      item.durationMs = durationMs;

      await freshGuild.save();
      return i.reply({ content: `✅ Successfully updated rentable **${item.name}** in the storefront!\n* **Price:** 💰 ${priceVal.toLocaleString()} per ${formatDuration(durationMs)}\n* **Type:** 🔑 **Rentable**\n\n*Please re-open the setup dashboard to refresh the active listings table.*`, flags: [MessageFlags.Ephemeral] });
    }
  });
}

