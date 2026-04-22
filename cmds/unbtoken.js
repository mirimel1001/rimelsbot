const { 
  EmbedBuilder, 
  ActionRowBuilder, 
  ButtonBuilder, 
  ButtonStyle, 
  ModalBuilder, 
  TextInputBuilder, 
  TextInputStyle, 
  PermissionsBitField,
  MessageFlags
} = require('discord.js');
const axios = require('axios');
const { saveServerToken, removeServerToken } = require('../utils/economy.js');

module.exports = {
  name: "unbelievatoken",
  aliases: ["unbtoken"],
  description: "Configure a custom UnbelievaBoat API token for this server's payouts.",
  usage: "unbtoken",
  run: async (client, message, args, prefix, config) => {
    // Permission check
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator) && message.author.id !== message.guild.ownerId) {
      return message.reply("❌ You need **Administrator** permissions to use this command.");
    }

    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('💰 UnbelievaBoat Economy Configuration')
      .setDescription(
        "To enable economy payouts (Werewolf prizes, betting, etc.), you must link this server to an UnbelievaBoat API token.\n\n" +
        "**Status:** ⚠️ Economy Actions are currently **Disabled** for this server until a token is provided.\n\n" +
        "**Privacy:** Your token is stored securely and never shared. You can remove it at any time to revert to the default."
      )
      .setFooter({ text: 'Other server owners must provide their own UnbelievaBoat API key.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('unb_set')
        .setLabel('Set Custom Token')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('unb_guide')
        .setLabel('❓ How to Setup')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('unb_remove')
        .setLabel('Remove / Reset')
        .setStyle(ButtonStyle.Danger)
    );

    const mainMsg = await message.reply({ embeds: [embed], components: [row] });

    const collector = mainMsg.createMessageComponentCollector({ time: 60000 });

    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });

      if (i.customId === 'unb_guide') {
        const guideEmbed = new EmbedBuilder()
          .setColor('#3498DB')
          .setTitle('📖 UnbelievaBoat Setup Guide')
          .setDescription(
            "1. **Open Applications**: Go to [unbelievaboat.com/applications](https://unbelievaboat.com/applications).\n" +
            "2. **Create App**: Click **'New Application'**. In the **Bot Client ID** field, paste: `618719221781626912` and click **Save Changes**.\n" +
            "3. **Authorize**: Scroll down to the **Authorization URL**, open the link, and authorize the bot for your server.\n" +
            "4. **Copy Token**: Copy the **API Token** from the top of the UnbelievaBoat application page.\n" +
            "5. **Link Bot**: Click **'Set Custom Token'** on the previous message and paste your key."
          )
          .setFooter({ text: 'The token allows our bot to update balances in your server.' });
        return i.reply({ embeds: [guideEmbed], flags: [MessageFlags.Ephemeral] });
      }

      if (i.customId === 'unb_set') {
        const modal = new ModalBuilder()
          .setCustomId('unb_modal')
          .setTitle('Set UnbelievaBoat Token');

        const tokenInput = new TextInputBuilder()
          .setCustomId('unb_token_input')
          .setLabel('API Token')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('Paste your token here...')
          .setRequired(true);

        modal.addComponents(new ActionRowBuilder().addComponents(tokenInput));
        await i.showModal(modal);

        try {
          const submitted = await i.awaitModalSubmit({
            time: 60000,
            filter: mi => mi.customId === 'unb_modal' && mi.user.id === i.user.id,
          });

          if (submitted) {
            const newToken = submitted.fields.getTextInputValue('unb_token_input').trim();
            
            // --- LIVE VALIDATION ---
            await submitted.reply({ content: '🔍 **Validating token...**', flags: [MessageFlags.Ephemeral] });
            try {
              await axios.get(`https://unbelievaboat.com/api/v1/guilds/${i.guildId}/users/${client.user.id}`, {
                headers: { 'Authorization': newToken }
              });
            } catch (apiErr) {
              return submitted.editReply({ content: '❌ **Invalid Token!** UnbelievaBoat rejected this key. Please ensure it is copied correctly and that the bot is in this server.' });
            }
            // -----------------------

            saveServerToken(client, i.guildId, newToken);
            await submitted.editReply({ content: '✅ **Success!** This server will now use your custom UnbelievaBoat token for all economy actions.' });
            
            // Update the main message to reflect the change
            const updatedEmbed = EmbedBuilder.from(embed).setDescription("✅ **Custom token is active.** Payouts will now use your server's specific key.");
            await mainMsg.edit({ embeds: [updatedEmbed] }).catch(() => null);
          }
        } catch (err) {}
      }

      if (i.customId === 'unb_remove') {
        removeServerToken(client, i.guildId);
        await i.reply({ content: '🗑️ **Token Removed.** Reverted to the global default economy token.', flags: [MessageFlags.Ephemeral] });
        
        const resetEmbed = EmbedBuilder.from(embed).setDescription("🔄 **Reset complete.** This server is now using the global fallback token.");
        await mainMsg.edit({ embeds: [resetEmbed] }).catch(() => null);
      }
    });

    collector.on('end', () => {
      mainMsg.edit({ components: [] }).catch(() => null);
    });
  }
};
