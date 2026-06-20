/**
 * Handles prefix-less Hgm broadcast commands specifically in Direct Messages.
 * This keeps index.js and other game handlers clean.
 */
module.exports = async (client, message, prefix, getConfig) => {
  if (message.guild) return false;

  const trimmed = message.content.trim();
  const lower = trimmed.toLowerCase();

  // Check if it starts with the command prefix/trigger 'h'
  const isHCommand = lower === 'h' || lower.startsWith('h ');
  if (!isHCommand) return false;

  const HgmGroup = require('../../models/HgmGroup');
  const isOwner = client.owners.has(message.author.id);
  const isMember = await HgmGroup.findOne({ userId: message.author.id });

  // If the user is neither an owner nor an active group member, do not intercept
  if (!isOwner && !isMember) return false;

  const args = trimmed.split(/ +/).slice(1);
  const subCommand = args[0]?.toLowerCase();

  // Handle HGM replies
  if (subCommand === 'reply' || subCommand === 'r') {
    const replyText = trimmed.split(/ +/).slice(2).join(' ');
    if (!replyText) {
      await message.reply('❌ Please specify a message to send. Usage: `h reply [text]` or `h r [text]`');
      return true;
    }

    const { EmbedBuilder } = require('discord.js');
    const forwardEmbed = new EmbedBuilder()
      .setTitle('💬 New HGM Reply')
      .setColor('#5865F2')
      .setDescription(replyText)
      .addFields({
        name: '👤 Sender Info',
        value: `${message.author.displayName || message.author.username} (@${message.author.username}) - ${message.author} (ID: \`${message.author.id}\`)`
      })
      .setThumbnail(message.author.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    let sentCount = 0;
    for (const ownerId of client.owners) {
      try {
        const owner = await client.users.fetch(ownerId);
        await owner.send({ embeds: [forwardEmbed] });
        sentCount++;
      } catch (err) {
        console.error(`Failed to forward HGM reply to owner ${ownerId}:`, err);
      }
    }

    if (sentCount > 0) {
      await message.reply('✅ Your reply has been forwarded to the bot owner(s).');
    } else {
      await message.reply('❌ Failed to forward the message.');
    }
    return true;
  }

  // If not a reply command, only owners are allowed to execute it
  if (!isOwner) {
    await message.reply('❌ You can only use: `h reply [text]` or `h r [text]` to reply to the owner.');
    return true;
  }

  // Run standard owner commands
  const hgmCmd = require('./hgm.js');
  try {
    await hgmCmd.run(client, message, args, prefix, getConfig());
  } catch (err) {
    console.error(err);
    await message.reply('❌ Command Error.');
  }
  return true;
};
