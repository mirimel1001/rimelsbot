const { EmbedBuilder, PermissionsBitField, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const Guild = require('../../models/Guild');

module.exports = {
  name: "activityrole",
  aliases: ["ar"],
  category: "Activity Role Event",
  adminOnly: true,
  description: "Manage activity roles. (Rolling 14-day window)\n🔹 **Sub-commands:**\n• `setup` / `set`: Create new rule\n• `list`: Show server rules\n• `del` / `delete`: Remove rule\n• `edit`: Open dashboard\n🔹 **Edit Options & Aliases:**\n• `req msgs` / `msgs`: Msg count\n• `lc` / `logchannel`: Public log\n• `alc` / `adminlogchannel`: Admin log\n• `dl` / `deletelog`: Auto-delete\n• `dt` / `deletetime`: Timer (s)\n• `msg` / `message`: Custom msg",
  usage: "ar [sub-command] [ID/Name]",
  run: async (client, message, args, prefix, config) => {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need **Administrator** permissions to use this command.');
    }

    const subCommand = args[0]?.toLowerCase();
    const guildId = message.guild.id;

    // Load current configs
    let configs = client.arConfigs.get(guildId) || [];

    const saveConfigs = async (gid, currentConfigs) => {
      try {
        await Guild.findOneAndUpdate(
          { guildId: gid },
          { activityRoles: currentConfigs },
          { upsert: true }
        );
        client.arConfigs.set(gid, currentConfigs);
      } catch (err) {
        console.error(`[DB Error] Failed to save AR configs for guild ${gid}:`, err);
        message.reply('❌ Database Error: Failed to save changes.');
      }
    };

    if (subCommand === 'setup' || subCommand === 'set') {
      const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[1]);
      const name = args.slice(2).join(' ');

      if (!role || !name) {
        return message.reply(`❌ Usage: \`${prefix}ar setup @role Activity Name\``);
      }

      const newConfig = {
        id: Date.now().toString().slice(-6),
        roleId: role.id,
        name: name,
        req_msgs: 5,
        logChannel: 'same',
        adminLogChannel: null,
        deleteLog: false,
        deleteTime: 60
      };

      configs.push(newConfig);
      await saveConfigs(guildId, configs);

      return message.reply(`✅ **Activity Role Created!**\n**ID:** \`${newConfig.id}\`\n**Role:** ${role}\n**Requirement:** 5 messages in 14 days.`);
    }

    if (subCommand === 'list') {
      if (configs.length === 0) return message.reply('❌ No activity roles configured for this server.');
 
      const embed = new EmbedBuilder()
        .setTitle('📋 Activity Roles')
        .setColor('#5865F2')
        .setDescription(configs.map(c => 
          `**ID:** \`${c.id}\` | **${c.name}** | **Role:** <@&${c.roleId}> | **Requirement:** ${c.req_msgs} msgs`
        ).join('\n'))
        .setFooter({ text: `${prefix}ar edit [Name/ID] to manage settings.` });
 
      return message.reply({ embeds: [embed] });
    }

    if (subCommand === 'del' || subCommand === 'delete') {
      const input = args.slice(1).join(' ');
      if (!input) return message.reply('❌ Specify the unique ID or Name of the activity to delete.');

      const filtered = configs.filter(c => c.id !== input && c.name.toLowerCase() !== input.toLowerCase());
      if (filtered.length === configs.length) return message.reply('❌ No activity found with that ID/Name.');

      await saveConfigs(guildId, filtered);
      return message.reply(`✅ Activity role **${input}** deleted.`);
    }

    if (subCommand === 'edit') {
      const validOptions = ['logchannel', 'lc', 'adminlogchannel', 'alc', 'deletelog', 'dl', 'deletetime', 'dt', 'msgs', 'message', 'msg', 'requirement', 'req'];
      const option = args[1]?.toLowerCase();
      const isDirectEdit = validOptions.includes(option);
      
      let ar;
      let value;

      if (isDirectEdit) {
        const isReq = (option === 'requirement' || option === 'req');
        const nextArg = args[2]?.toLowerCase();

        if (isReq && nextArg === 'msgs') {
            // Handle "req msgs [count] [ID]"
            value = args[3];
            const targetId = args.slice(4).join(' ') || args[3];
            ar = configs.find(c => c.id === targetId || c.name.toLowerCase() === targetId?.toLowerCase());
        } else {
            value = args[2];
            const targetId = args.slice(3).join(' ') || args[1];
            ar = configs.find(c => c.id === targetId || c.name.toLowerCase() === targetId?.toLowerCase());
        }
      } else {
        const targetId = args.slice(1).join(' ');
        ar = configs.find(c => c.id === targetId || c.name.toLowerCase() === targetId.toLowerCase()) ||
             configs.find(c => c.id === args[1] || c.name.toLowerCase() === args[1]?.toLowerCase());
      }

      // If no valid option or it's a name/ID for interactive menu
      if (!option || !isNaN(option) || (!isDirectEdit && ar)) {
        const targetAr = ar || configs.find(c => c.id === option || c.name.toLowerCase() === option?.toLowerCase());
        if (!targetAr) return message.reply('❌ Specify a valid Activity ID or Name to edit.');

        const generateEmbed = (data) => {
          return new EmbedBuilder()
            .setTitle(`⚙️ Editing Activity: ID: ${data.id} | ${data.name}`)
            .setColor('#2F3136')
            .addFields(
              { name: '📍 Target Role', value: `<@&${data.roleId}>`, inline: true },
              { name: '🔢 Requirement', value: `${data.req_msgs} messages`, inline: true },
              { name: '\u200B', value: '\u200B', inline: true },
              { name: '📢 Public Log', value: data.logChannel === 'same' ? '`Current Channel`' : (data.logChannel ? `<#${data.logChannel}>` : 'Disabled'), inline: true },
              { name: '🛡️ Admin Log', value: data.adminLogChannel === 'same' ? '`Current Channel`' : (data.adminLogChannel ? `<#${data.adminLogChannel}>` : 'Disabled'), inline: true },
              { name: '⏱️ Deletion', value: data.deleteLog ? `Yes (${data.deleteTime}s)` : 'No', inline: true },
              { name: '📝 Custom Message', value: `${data.customMessage || 'Congrats you just got {name} role {role}!'}\n\n**Commands**\n\`\`\`${prefix}ar del ${data.id}\`\`\`\n\`\`\`msgs\`\`\`\n\`\`\`lc\`\`\`\n\`\`\`alc\`\`\`\n\`\`\`dl\`\`\`\n\`\`\`dt\`\`\`\n\`\`\`msg\`\`\`` }
            );
        };

        const generateButtons = (data) => {
          const row1 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`ar_toggle_del_${data.id}`)
              .setLabel(data.deleteLog ? 'Disable Auto-Delete' : 'Enable Auto-Delete')
              .setStyle(data.deleteLog ? ButtonStyle.Danger : ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`ar_edit_dt_${data.id}`)
              .setLabel('Set Timer (DT)')
              .setStyle(ButtonStyle.Secondary),
            new ButtonBuilder()
              .setCustomId(`ar_edit_threshold_${data.id}`)
              .setLabel('Set Requirement (MSGS)')
              .setStyle(ButtonStyle.Secondary)
          );

          const row2 = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`ar_edit_lc_${data.id}`)
              .setLabel('Set Public Log (LC)')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`ar_edit_alc_${data.id}`)
              .setLabel('Set Admin Log (ALC)')
              .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
              .setCustomId(`ar_edit_msg_${data.id}`)
              .setLabel('Set Message (MSG)')
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`ar_reset_msg_${data.id}`)
              .setLabel('Reset Message')
              .setStyle(ButtonStyle.Danger)
          );

          return [row1, row2];
        };

        const menuMsg = await message.reply({ 
          embeds: [generateEmbed(targetAr)], 
          components: generateButtons(targetAr) 
        });

        const collector = menuMsg.createMessageComponentCollector({ 
          filter: i => i.user.id === message.author.id, 
          time: 60000 
        });

        collector.on('collect', async i => {
          if (i.customId.startsWith('ar_toggle_del_')) {
            targetAr.deleteLog = !targetAr.deleteLog;
            await saveConfigs(guildId, configs);
            await i.update({ embeds: [generateEmbed(targetAr)], components: generateButtons(targetAr) });
          } else if (i.customId.startsWith('ar_reset_msg_')) {
            targetAr.customMessage = null;
            await saveConfigs(guildId, configs);
            await i.update({ embeds: [generateEmbed(targetAr)], components: generateButtons(targetAr) });
          } else if (i.customId.startsWith('ar_edit_lc_') || i.customId.startsWith('ar_edit_alc_')) {
            const isLc = i.customId.includes('_lc_');
            const promptResponse = await i.reply({ content: `📍 **Please mention the ${isLc ? 'Public' : 'Admin'} log channel** (or paste the ID/Link) in the chat.\nType \`same\` to use the channel where the user is active, or \`off\` to disable.`, withResponse: true });
            const prompt = promptResponse.resource.message;

            const msgCollector = i.channel.createMessageCollector({ 
              filter: m => m.author.id === i.user.id, 
              time: 30000, 
              max: 1 
            });

            msgCollector.on('collect', async m => {
              const linkMatch = m.content.match(/https:\/\/discord\.com\/channels\/\d+\/(\d+)/);
              const idMatch = m.content.match(/\d{17,20}/);
              const channelId = linkMatch ? linkMatch[1] : (m.mentions.channels.first()?.id || (idMatch ? idMatch[0] : null));
              
              const channel = m.guild.channels.cache.get(channelId);
              const off = m.content.toLowerCase() === 'off';
              const same = m.content.toLowerCase() === 'same';

              if (off) {
                targetAr[isLc ? 'logChannel' : 'adminLogChannel'] = null;
              } else if (same) {
                targetAr[isLc ? 'logChannel' : 'adminLogChannel'] = 'same';
              } else if (channel) {
                targetAr[isLc ? 'logChannel' : 'adminLogChannel'] = channel.id;
              } else {
                return m.reply('❌ Invalid channel or link. Operation cancelled.').then(msg => setTimeout(() => msg.delete().catch(() => null), 5000));
              }

              await saveConfigs(guildId, configs);
              await menuMsg.edit({ embeds: [generateEmbed(targetAr)], components: generateButtons(targetAr) });
              await prompt.delete().catch(() => null);
              await m.delete().catch(() => null);
            });
          } else {
            // Handle Modals (DT, MSGS, MSG)
            const { ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
            const modal = new ModalBuilder().setCustomId(`ar_modal_${i.id}`).setTitle('Edit Activity Role');
            
            let fieldId, label, placeholder, currentVal;
            if (i.customId.startsWith('ar_edit_dt_')) {
              fieldId = 'dt'; label = 'Delete Time (30-180s)'; placeholder = '60'; currentVal = targetAr.deleteTime.toString();
            } else if (i.customId.startsWith('ar_edit_threshold_')) {
              fieldId = 'msgs'; label = 'Message Requirement'; placeholder = '5'; currentVal = targetAr.req_msgs.toString();
            } else if (i.customId.startsWith('ar_edit_msg_')) {
              fieldId = 'msg'; label = 'Custom Message'; placeholder = 'Use {user}, {role}, {name}'; currentVal = targetAr.customMessage || '';
            }

            const input = new TextInputBuilder()
              .setCustomId(fieldId)
              .setLabel(label)
              .setPlaceholder(placeholder)
              .setValue(currentVal)
              .setStyle(fieldId === 'msg' ? TextInputStyle.Paragraph : TextInputStyle.Short)
              .setRequired(true);

            modal.addComponents(new ActionRowBuilder().addComponents(input));
            await i.showModal(modal);

            const submitted = await i.awaitModalSubmit({ time: 60000 }).catch(() => null);
            if (submitted) {
              const val = submitted.fields.getTextInputValue(fieldId);
              if (fieldId === 'dt' || fieldId === 'msgs') {
                const num = parseInt(val);
                if (!isNaN(num)) targetAr[fieldId === 'dt' ? 'deleteTime' : 'req_msgs'] = num;
              } else if (fieldId === 'msg') {
                targetAr.customMessage = val || null;
              }

              await saveConfigs(guildId, configs);
              await submitted.update({ embeds: [generateEmbed(targetAr)], components: generateButtons(targetAr) });
            }
          }
        });

        return;
      }

      // Direct Command Logic
      if (!ar) return message.reply('❌ Activity ID not found. Usage: `ar edit [option] [value] [ID]`');

      switch (option) {
        case 'logchannel':
        case 'lc':
          const lChan = message.mentions.channels.first()?.id || value;
          if (!lChan) return message.reply('❌ Mention a channel or provide an ID.');
          ar.logChannel = lChan;
          break;
        case 'adminlogchannel':
        case 'alc':
          const aChan = message.mentions.channels.first()?.id || value;
          if (!aChan) return message.reply('❌ Mention a channel or provide an ID.');
          ar.adminLogChannel = aChan;
          break;
        case 'deletelog':
        case 'dl':
          ar.deleteLog = value === 'true';
          break;
        case 'deletetime':
        case 'dt':
          const time = parseInt(value);
          if (isNaN(time) || time < 30 || time > 180) return message.reply('❌ Time must be between 30 and 180 seconds.');
          ar.deleteTime = time;
          break;
        case 'requirement':
        case 'req':
        case 'msgs':
          const count = parseInt(value);
          if (isNaN(count)) return message.reply('❌ Provide a valid number.');
          ar.req_msgs = count;
          break;
        case 'message':
        case 'msg':
          const customMsg = args.slice(2, -1).join(' ') || value; // Try to capture full string
          if (!customMsg) return message.reply('❌ Provide a message. Use {user}, {role}, {name} as placeholders.');
          ar.customMessage = customMsg === 'default' ? null : customMsg;
          break;
      }

      await saveConfigs(guildId, configs);
      return message.reply(`✅ Updated **${option}** for activity **${ar.name}**.`);
    }

    // Default help
    const helpEmbed = new EmbedBuilder()
      .setTitle('⚙️ Activity Role Management')
      .setColor('#F1C40F')
      .addFields(
        { name: `➕ setup`, value: `\`${prefix}ar setup @role Name\`` },
        { name: `📜 list`, value: `\`${prefix}ar list\`` },
        { name: `🗑️ del`, value: `\`${prefix}ar del [ID/Name]\`` },
        { name: `✏️ edit`, value: `\`${prefix}ar edit [ID/Name]\` (Opens Menu)` },
        { name: `🚀 Quick Edit`, value: `\`${prefix}ar edit [option] [value] [ID/Name]\`\n**Options:** msgs, lc, alc, dl, dt, msg` },
        { name: `📝 Placeholders`, value: `{user}, {role}, {name}` }
      );

    return message.reply({ embeds: [helpEmbed] });
  }
};
