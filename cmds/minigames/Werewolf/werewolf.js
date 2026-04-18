const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

module.exports = {
  name: "werewolf",
  aliases: ["ww", "warewolf"],
  description: "Multiplayer Werewolf Game Logic.",
  usage: "werewolf [setup/join/leave/status/start/cancel]",
  run: async (client, message, args, prefix, config) => {
    const subCommand = args[0]?.toLowerCase();

    // 1. SETUP
    if (subCommand === 'setup') {
      if (client.werewolfGames.has(message.channel.id)) {
        return message.reply("⚠️ A Werewolf game is already in progress/setup here.");
      }

      // If no arguments or missing prize, enter INTERACTIVE CONFIG
      if (!args[1] || !args[5]) {
        return startInteractiveSetup(client, message, prefix);
      }

      const maxPlayers = parseInt(args[1]) || 15;
      const prize = parseInt(args[5]);
      
      // (Existing command-line setup logic remains for power users)
      return launchLobby(client, message, {
        host: message.author.id,
        hostName: message.author.username,
        maxPlayers,
        prize,
        wwCount: parseInt(args[2]) || null,
        dayTime: parseInt(args[3]) || null,
        nightTime: parseInt(args[4]) || null,
        seerMode: 'EXACT' // Default
      });
    }

    if (subCommand === 'status' || !subCommand) {
      const game = client.werewolfGames.get(message.channel.id);
      if (!game) return startInteractiveSetup(client, message, prefix);
      
      const players = Array.from(game.players.values()).map(p => `• ${p.name}`).join('\n') || 'None';
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🐺 Werewolf Lobby Status')
        .setDescription(`**Host:** ${game.hostName}\n**Prize Pool:** 💰 ${game.prize}\n**Players (${game.players.size}/${game.maxPlayers}):**\n${players}`)
        .setFooter({ text: 'Host can use "rwerewolf start" or "rwerewolf cancel"' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ww_join').setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ww_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ww_start').setLabel('Start (Host)').setStyle(ButtonStyle.Primary)
      );

      return message.channel.send({ embeds: [embed], components: [row] });
    }

    if (subCommand === 'join') {
      const game = client.werewolfGames.get(message.channel.id);
      if (!game) return message.reply("❌ No game active.");
      if (game.players.has(message.author.id)) return message.reply("You are already joined.");
      if (game.players.size >= game.maxPlayers) return message.reply("Lobby is full.");
      
      game.players.set(message.author.id, { name: message.author.username, role: null, alive: true, ready: false });
      return message.reply("✅ Joined the lobby!");
    }

    if (subCommand === 'leave') {
      const game = client.werewolfGames.get(message.channel.id);
      if (!game) return message.reply("❌ No game active.");
      if (!game.players.has(message.author.id)) return message.reply("You aren't in the lobby.");
      game.players.delete(message.author.id);
      return message.reply("👋 Left the lobby.");
    }

    if (subCommand === 'start') {
      const game = client.werewolfGames.get(message.channel.id);
      if (!game) return message.reply("❌ No game active.");
      if (message.author.id !== game.host) return message.reply("Only the host can start.");
      if (game.players.size < 4) return message.reply("Need at least 4 players.");
      return startGame(client, message.channel, game);
    }

    if (subCommand === 'cancel') {
      const game = client.werewolfGames.get(message.channel.id);
      if (!game) return message.reply("❌ No game active.");
      if (message.author.id !== game.host) return message.reply("Only the host can cancel.");
      
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${game.host}`, { cash: game.prize }, {
        headers: { 'Authorization': process.env.UNB_TOKEN }
      });

      client.werewolfGames.delete(message.channel.id);
      return message.reply("⭕ Game cancelled. Host has been refunded.");
    }
  }
};

async function updateLobby(msg, game) {
  const players = Array.from(game.players.values()).map(p => `• ${p.name}`).join('\n') || 'None';
  const embed = new EmbedBuilder(msg.embeds[0].data)
    .setDescription(`**Host:** <@${game.host}>\n**Prize Pool:** 💰 ${game.prize}\n**Seer Mode:** ${game.seerMode}\n\nClick "Join" or use \`rww join\` to participate!`)
    .setFields({ name: `Players (${game.players.size}/${game.maxPlayers})`, value: players });
  await msg.edit({ embeds: [embed] }).catch(() => {});
}

async function startGame(client, channel, game) {
  const engine = require('./engine.js');
  game.status = 'STARTING';
  channel.send("🌑 **The game is starting! Check your DMs for roles...**");
  engine.run(client, channel, game);
}

async function launchLobby(client, message, settings) {
  // Verify and Deduct
  try {
    const ubCheck = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${settings.host}`, {
      headers: { 'Authorization': process.env.UNB_TOKEN }
    });

    if (ubCheck.data.cash < settings.prize) return message.reply(`❌ Insufficient funds! You need \`${settings.prize}\` cash.`);

    await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${settings.host}`, { cash: -settings.prize }, {
      headers: { 'Authorization': process.env.UNB_TOKEN }
    });
  } catch (err) {
    return message.reply(`❌ tech Error: ${err.message}`);
  }

  const gameState = {
    ...settings,
    channelId: message.channel.id,
    players: new Map(),
    status: 'LOBBY'
  };

  client.werewolfGames.set(message.channel.id, gameState);

  const lobbyEmbed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🐺 Werewolf Lobby')
    .setDescription(`**Host:** <@${gameState.host}>\n**Prize Pool:** 💰 ${gameState.prize}\n**Seer Mode:** ${gameState.seerMode}\n\nClick "Join" or use \`rww join\` to participate!`)
    .setFooter({ text: 'Min 4 players required to start.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ww_join').setLabel('Join').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ww_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ww_start').setLabel('Start (Host)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ww_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  const msg = await message.channel.send({ embeds: [lobbyEmbed], components: [row] });
  
  const collector = msg.createMessageComponentCollector({ time: 3600000 }); // 1 hour lobby

  collector.on('collect', async (i) => {
    const game = client.werewolfGames.get(i.channelId);
    if (!game) return i.update({ content: 'Game session expired.', embeds: [], components: [] });

    if (i.customId === 'ww_join') {
      if (game.players.has(i.user.id)) return i.reply({ content: 'Already joined!', ephemeral: true });
      if (game.players.size >= game.maxPlayers) return i.reply({ content: 'Lobby is full!', ephemeral: true });
      game.players.set(i.user.id, { name: i.user.username, role: null, alive: true, ready: false });
      i.reply({ content: '✅ Joined!', ephemeral: true });
      updateLobby(msg, game);
    }
    if (i.customId === 'ww_leave') {
      if (!game.players.has(i.user.id)) return i.reply({ content: 'Not in lobby.', ephemeral: true });
      game.players.delete(i.user.id);
      i.reply({ content: '👋 Left.', ephemeral: true });
      updateLobby(msg, game);
    }
    if (i.customId === 'ww_cancel') {
      if (i.user.id !== game.host) return i.reply({ content: 'Host only.', ephemeral: true });
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${i.guildId}/users/${game.host}`, { cash: game.prize }, {
        headers: { 'Authorization': process.env.UNB_TOKEN }
      });
      client.werewolfGames.delete(i.channelId);
      collector.stop();
      i.update({ content: '⭕ Cancelled & Refunded.', embeds: [], components: [] });
    }
    if (i.customId === 'ww_start') {
      if (i.user.id !== game.host) return i.reply({ content: 'Host only.', ephemeral: true });
      if (game.players.size < 4) return i.reply({ content: 'Need min 4 players!', ephemeral: true });
      collector.stop('started');
      startGame(client, i.channel, game);
    }
  });
}

async function startInteractiveSetup(client, message, prefix) {
  let settings = {
    host: message.author.id,
    hostName: message.author.username,
    maxPlayers: 10,
    prize: 0,
    seerMode: 'EXACT',
    dayTime: null,
    nightTime: null
  };

  const generateEmbed = () => new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🌑 Werewolf Setup: Configuration')
    .setDescription('Configure your event using the buttons below before launching the lobby.')
    .addFields(
      { name: '💰 Prize Pool', value: settings.prize > 0 ? `💰 ${settings.prize}` : '❌ *Not Set*', inline: true },
      { name: '👥 Max Players', value: `${settings.maxPlayers}`, inline: true },
      { name: '🔮 Seer Mode', value: settings.seerMode === 'EXACT' ? '✅ Exact' : '❓ Simple', inline: true }
    );

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('set_prize').setLabel('Set Prize').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('set_players').setLabel('Max Players').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_seer').setLabel('Toggle Seer').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('launch').setLabel('🚀 Launch Lobby').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('exit').setLabel('Exit').setStyle(ButtonStyle.Danger)
  );

  const configMsg = await message.reply({ embeds: [generateEmbed()], components: [row, row2] });
  const collector = configMsg.createMessageComponentCollector({ time: 120000 });

  collector.on('collect', async (i) => {
    if (i.user.id !== settings.host) return i.reply({ content: 'Only the host can configure.', ephemeral: true });

    if (i.customId === 'set_prize') {
      await i.reply({ content: '💬 Please type the **total prize amount** in chat now.', ephemeral: true });
      const filter = m => m.author.id === settings.host && !isNaN(m.content);
      const collected = await message.channel.awaitMessages({ filter, max: 1, time: 30000 });
      if (collected.size > 0) {
        settings.prize = parseInt(collected.first().content);
        collected.first().delete().catch(() => {});
        i.editReply({ content: `✅ Prize set to **${settings.prize}**!` });
        configMsg.edit({ embeds: [generateEmbed()] });
      }
    }
    if (i.customId === 'set_players') {
      const counts = [5, 10, 15, 20];
      const curIdx = counts.indexOf(settings.maxPlayers);
      settings.maxPlayers = counts[(curIdx + 1) % counts.length];
      await i.update({ embeds: [generateEmbed()] });
    }
    if (i.customId === 'set_seer') {
      settings.seerMode = settings.seerMode === 'EXACT' ? 'SIMPLE' : 'EXACT';
      await i.update({ embeds: [generateEmbed()] });
    }
    if (i.customId === 'launch') {
      if (settings.prize <= 0) return i.reply({ content: '❌ You must set a prize pool first!', ephemeral: true });
      collector.stop('launched');
      i.update({ content: '🚀 Launching Lobby...', embeds: [], components: [] });
      launchLobby(client, message, settings);
    }
    if (i.customId === 'exit') {
      collector.stop();
      i.update({ content: '⭕ Setup cancelled.', embeds: [], components: [] });
    }
  });
}
