const { EmbedBuilder, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
  name: "activityrole",
  aliases: ["ar"],
  category: "Activity Role Event",
  adminOnly: true,
  description: "Manage activity-based role requirements.",
  usage: "ar [setup/list/del/setcount/setrole] [args]",
  run: async (client, message, args, prefix, config) => {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      return message.reply('❌ You need **Administrator** permissions to use this command.');
    }

    const subCommand = args[0]?.toLowerCase();
    const guildId = message.guild.id;

    // Load current configs
    let configs = client.arConfigs.get(guildId) || [];

    const saveConfigs = (gid, currentConfigs) => {
      const mainGuildId = process.env.MAIN_GUILD_ID?.trim().replace(/^["'](.+)["']$/, '$1');
      
      if (gid === mainGuildId) {
        const defaultPath = path.join(__dirname, '../../default_myserver.json');
        if (fs.existsSync(defaultPath)) {
          const data = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));
          data.activityRoles = currentConfigs;
          fs.writeFileSync(defaultPath, JSON.stringify(data, null, 2));
        }
      } else {
        const arConfigPath = path.join(__dirname, '../../ar_configs.json');
        client.arConfigs.set(gid, currentConfigs);
        const allData = Object.fromEntries(client.arConfigs);
        fs.writeFileSync(arConfigPath, JSON.stringify(allData, null, 2));
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
        threshold: 5
      };

      configs.push(newConfig);
      client.arConfigs.set(guildId, configs);
      saveConfigs(guildId, configs);

      return message.reply(`✅ **Activity Role Created!**\n**ID:** \`${newConfig.id}\`\n**Role:** ${role}\n**Requirement:** 5 messages in 14 days.`);
    }

    if (subCommand === 'list') {
      if (configs.length === 0) return message.reply('❌ No activity roles configured for this server.');

      const embed = new EmbedBuilder()
        .setTitle('📋 Activity Roles')
        .setColor('#5865F2')
        .setDescription(configs.map(c => `**ID:** \`${c.id}\` | **${c.name}**\nRole: <@&${c.roleId}> | Threshold: ${c.threshold} msgs`).join('\n\n'));

      return message.reply({ embeds: [embed] });
    }

    if (subCommand === 'del' || subCommand === 'delete') {
      const id = args[1];
      if (!id) return message.reply('❌ Specify the unique ID of the activity to delete.');

      const filtered = configs.filter(c => c.id !== id && c.name.toLowerCase() !== id.toLowerCase());
      if (filtered.length === configs.length) return message.reply('❌ No activity found with that ID/Name.');

      client.arConfigs.set(guildId, filtered);
      saveConfigs(guildId, filtered);

      return message.reply(`✅ Activity role deleted.`);
    }

    if (subCommand === 'setcount') {
      const id = args[1];
      const count = parseInt(args[2]);

      if (!id || isNaN(count)) return message.reply(`❌ Usage: \`${prefix}ar setcount [ID] [number]\``);

      const config = configs.find(c => c.id === id);
      if (!config) return message.reply('❌ Activity ID not found.');

      config.threshold = count;
      client.arConfigs.set(guildId, configs);
      saveConfigs(guildId, configs);

      return message.reply(`✅ Updated! **${config.name}** now requires **${count}** messages.`);
    }

    if (subCommand === 'setrole') {
      const id = args[1];
      const role = message.mentions.roles.first() || message.guild.roles.cache.get(args[2]);

      if (!id || !role) return message.reply(`❌ Usage: \`${prefix}ar setrole [ID] @role\``);

      const config = configs.find(c => c.id === id);
      if (!config) return message.reply('❌ Activity ID not found.');

      config.roleId = role.id;
      client.arConfigs.set(guildId, configs);
      saveConfigs(guildId, configs);

      return message.reply(`✅ Updated! **${config.name}** will now grant ${role}.`);
    }

    // Default help if no valid subcommand
    const helpEmbed = new EmbedBuilder()
      .setTitle('⚙️ Activity Role Management')
      .setColor('#F1C40F')
      .addFields(
        { name: `➕ setup`, value: `\`${prefix}ar setup @role Name\`` },
        { name: `📜 list`, value: `\`${prefix}ar list\`` },
        { name: `🗑️ del`, value: `\`${prefix}ar del [ID]\`` },
        { name: `🔢 setcount`, value: `\`${prefix}ar setcount [ID] [count]\`` },
        { name: `🎭 setrole`, value: `\`${prefix}ar setrole [ID] @role\`` }
      );

    return message.reply({ embeds: [helpEmbed] });
  }
};
