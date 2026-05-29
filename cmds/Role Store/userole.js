const { EmbedBuilder, PermissionsBitField } = require('discord.js');
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
  name: "userole",
  aliases: ["ur", "equip", "unequip"],
  description: "Equip a role from inventory to yourself, equip it on a friend, or unequip it.",
  usage: "ur [inventory id/number] [empty for yourself / @friend] OR ur unequip [inventory id/number]",
  run: async (client, message, args, prefix, config) => {
    if (!message.guild) return message.reply("❌ Roles can only be equipped inside a server.");

    const firstArg = args[0]?.toLowerCase();

    // -------------------------------------------------------------
    // --- 1. SUBCOMMAND: UNEQUIP A ROLE ---
    // -------------------------------------------------------------
    if (firstArg === 'unequip' || firstArg === 'take' || firstArg === 'remove') {
      const indexInput = args[1];
      if (!indexInput) {
        return message.reply(`❌ **Usage:** \`${prefix}ur unequip [inventory id/number]\``);
      }

      const inv = await Inventory.findOne({ guildId: message.guild.id, userId: message.author.id });
      if (!inv || !inv.roles || inv.roles.length === 0) {
        return message.reply("📭 Your inventory is empty.");
      }

      const index = parseInt(indexInput);
      if (isNaN(index) || index < 1 || index > inv.roles.length) {
        return message.reply(`❌ **Invalid Inventory Number:** Please specify a number between 1 and ${inv.roles.length}.`);
      }

      const item = inv.roles[index - 1];

      if (!item.isUsed) {
        return message.reply("⚠️ This role is not currently equipped/active.");
      }

      const wearerId = item.assignedTo;
      
      message.channel.sendTyping();

      // Strip role on Discord
      const wearerMember = await message.guild.members.fetch(wearerId).catch(() => null);
      if (wearerMember) {
        const discordRole = await message.guild.roles.fetch(item.roleId).catch(() => null);
        if (discordRole) {
          try {
            await wearerMember.roles.remove(discordRole);
          } catch (err) {
            if (err.code === 50013) {
              return message.reply(`❌ **Permission Error:** The bot is unable to remove the role **${item.name}** because it is positioned higher than the bot's hierarchy role.`);
            }
            console.error('[Unequip Discord Error]', err);
          }
        }
      }

      // Update database status
      item.isUsed = false;
      item.assignedTo = null;
      await inv.save();

      const unequipEmbed = new EmbedBuilder()
        .setColor('#ED4245')
        .setTitle('🎒 Role Returned to Inventory')
        .setDescription(`Successfully unequipped **${item.name}** from ${wearerId === message.author.id ? 'yourself' : `<@${wearerId}>`}.`)
        .setFooter({ text: 'You can equip this role again at any time!' })
        .setTimestamp();

      return message.reply({ embeds: [unequipEmbed] });
    }

    // -------------------------------------------------------------
    // --- 2. MAIN COMMAND: EQUIP / GIFT TO MEMBER ---
    // -------------------------------------------------------------
    const indexInput = args[0];
    if (!indexInput) {
      return message.reply(`❌ **Usage:**\n* Equip: \`${prefix}ur [inventory id/number] [empty for yourself / @mention for friend]\`\n* Unequip: \`${prefix}ur unequip [inventory id/number]\``);
    }

    const index = parseInt(indexInput);
    if (isNaN(index)) {
      return message.reply(`❌ **Invalid Inventory Number:** Please specify the inventory index number.\n* Usage: \`${prefix}ur [inventory id/number] [empty for yourself / @mention for friend]\``);
    }

    const inv = await Inventory.findOne({ guildId: message.guild.id, userId: message.author.id });
    if (!inv || !inv.roles || inv.roles.length === 0) {
      return message.reply(`📭 Your inventory is empty! Buy roles using \`${prefix}br list\`.`);
    }

    if (index < 1 || index > inv.roles.length) {
      return message.reply(`❌ **Invalid Inventory Number:** Please specify a number between 1 and ${inv.roles.length}.`);
    }

    const item = inv.roles[index - 1];

    if (item.isUsed) {
      return message.reply(`⚠️ This role is already equipped on ${item.assignedTo === message.author.id ? 'yourself' : `<@${item.assignedTo}>`}! Unequip it first with \`${prefix}ur unequip ${index}\`.`);
    }

    // Check if role exists on Discord server
    const discordRole = await message.guild.roles.fetch(item.roleId).catch(() => null);
    if (!discordRole) {
      return message.reply("❌ The role associated with this item no longer exists in the Discord server.");
    }

    // Check if temporary role has expired (if purchased and already started timer)
    if (item.isTemporary && item.expiresAt && item.expiresAt < new Date()) {
      return message.reply("❌ This temporary role has already expired and cannot be equipped.");
    }

    let targetMember = message.member;
    const friendArg = args[1];
    if (friendArg) {
      const match = friendArg.match(/^<@!?(\d+)>$/) || [null, friendArg];
      const potentialMemberId = match[1];
      const member = await message.guild.members.fetch(potentialMemberId).catch(() => null);
      if (!member) {
        return message.reply("❌ **Friend Not Found:** Please mention a valid server friend (e.g. `@name`) or leave it empty to equip on yourself.");
      }
      targetMember = member;
    }

    message.channel.sendTyping();

    // Assign role to member on Discord
    try {
      await targetMember.roles.add(discordRole);
    } catch (err) {
      if (err.code === 50013) {
        return message.reply(`❌ **Permission Error:** The bot is unable to assign the role **${item.name}** because it is positioned higher than the bot's hierarchy role.`);
      }
      console.error('[Equip Discord Error]', err);
      return message.reply("❌ Failed to assign role on Discord.");
    }

    // Set activation and check dormant timer
    item.isUsed = true;
    item.assignedTo = targetMember.id;

    // Dormant Timer Activation: If temporary and never activated, start countdown now!
    let activatedNow = false;
    if (item.isTemporary && !item.expiresAt) {
      item.expiresAt = new Date(Date.now() + item.durationMs);
      activatedNow = true;
    }

    await inv.save();

    const isSelf = targetMember.id === message.author.id;
    const durationText = item.isTemporary ? ` (Expires: <t:${Math.floor(item.expiresAt.getTime() / 1000)}:R>)` : ' (Permanent)';

    const equipEmbed = new EmbedBuilder()
      .setColor('#43B581')
      .setTitle(isSelf ? '✨ Role Equipped Successfully!' : '🎁 Role Gifted & Equipped!')
      .setDescription(isSelf 
        ? `You successfully equipped the role **${item.name}** on **yourself**!${durationText}`
        : `You successfully gifted and equipped the role **${item.name}** to **${targetMember.toString()}**!${durationText}`
      )
      .setFooter({ text: `Type "${prefix}ur unequip ${index}" to return the role to inventory.` })
      .setTimestamp();

    if (activatedNow) {
      equipEmbed.addFields({ name: '⏳ Timer Activated!', value: `This temporary role's **${formatDuration(item.durationMs)}** timer has officially started ticking.` });
    }

    return message.reply({ embeds: [equipEmbed] });
  }
};
