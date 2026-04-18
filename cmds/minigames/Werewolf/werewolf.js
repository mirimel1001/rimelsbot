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

      const maxPlayers = parseInt(args[1]) || 15;
      const prize = parseInt(args[5]);
      
      if (!prize || isNaN(prize) || prize <= 0) {
        return message.reply(`❌ You must specify a prize pool.\nUsage: \`${prefix}werewolf setup [players] [werewolves] [day] [night] [prize]\``);
      }

      // Verify and Deduct
      try {
        const ubCheck = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, {
          headers: { 'Authorization': process.env.UNB_TOKEN }
        });

        if (ubCheck.data.cash < prize) return message.reply("❌ Insufficient funds.");

        await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${message.author.id}`, { cash: -prize }, {
          headers: { 'Authorization': process.env.UNB_TOKEN }
        });
      } catch (err) {
        return message.reply(`❌ Tech Error: ${err.message}`);
      }

      const gameState = {
        host: message.author.id,
        channelId: message.channel.id,
        maxPlayers,
        prize,
        wwCount: parseInt(args[2]) || null,
        dayTime: parseInt(args[3]) || null,
        nightTime: parseInt(args[4]) || null,
        players: new Map(),
        status: 'LOBBY',
        hostName: message.author.username
      };

      client.werewolfGames.set(message.channel.id, gameState);

      const lobbyEmbed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🐺 Werewolf Lobby')
        .setDescription(`**Host:** ${gameState.hostName}\n**Prize Pool:** 💰 ${prize}\n\nClick "Join" or use \`${prefix}ww join\` to participate!`)
        .setFooter({ text: 'Min 4 players required to start.' });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ww_join').setLabel('Join').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ww_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('ww_start').setLabel('Start (Host)').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ww_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
      );

      const msg = await message.channel.send({ embeds: [lobbyEmbed], components: [row] });
      
      // Setup Interaction Collector
      const collector = msg.createMessageComponentCollector({ time: 600000 }); // 10 mins lobby

      collector.on('collect', async (i) => {
        const game = client.werewolfGames.get(i.channelId);
        if (!game) return i.update({ content: 'Game session expired.', embeds: [], components: [] });

        if (i.customId === 'ww_join') {
          if (game.players.has(i.user.id)) return i.reply({ content: 'You are already joined!', ephemeral: true });
          if (game.players.size >= game.maxPlayers) return i.reply({ content: 'Lobby is full!', ephemeral: true });
          
          game.players.set(i.user.id, { name: i.user.username, role: null, alive: true, ready: false });
          i.reply({ content: '✅ You joined the lobby!', ephemeral: true });
          updateLobby(msg, game);
        }

        if (i.customId === 'ww_leave') {
          if (!game.players.has(i.user.id)) return i.reply({ content: 'You are not in the lobby.', ephemeral: true });
          game.players.delete(i.user.id);
          i.reply({ content: '👋 You left the lobby.', ephemeral: true });
          updateLobby(msg, game);
        }

        if (i.customId === 'ww_cancel') {
          if (i.user.id !== game.host) return i.reply({ content: 'Only the host can cancel.', ephemeral: true });
          
          // Refund
          await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${i.guildId}/users/${game.host}`, { cash: game.prize }, {
            headers: { 'Authorization': process.env.UNB_TOKEN }
          });

          client.werewolfGames.delete(i.channelId);
          collector.stop();
          i.update({ content: '⭕ Game cancelled. Host has been refunded.', embeds: [], components: [] });
        }

        if (i.customId === 'ww_start') {
          if (i.user.id !== game.host) return i.reply({ content: 'Only the host can start.', ephemeral: true });
          if (game.players.size < 4) return i.reply({ content: 'Need at least 4 players to start!', ephemeral: true });
          
          collector.stop('started');
          startGame(client, i.channel, game);
        }
      });

      return;
    }

    if (subCommand === 'status' || !subCommand) {
      const game = client.werewolfGames.get(message.channel.id);
      if (!game) return message.reply("❌ No Werewolf lobby active here.");
      
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
    .setFields({ name: `Players (${game.players.size}/${game.maxPlayers})`, value: players });
  await msg.edit({ embeds: [embed] }).catch(() => {});
}

async function startGame(client, channel, game) {
  const engine = require('./engine.js');
  game.status = 'STARTING';
  channel.send("🌑 **The game is starting! Check your DMs for roles...**");
  engine.run(client, channel, game);
}
