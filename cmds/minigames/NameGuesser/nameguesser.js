const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getEconomyToken, formatNumber } = require('../../../utils/economy.js');

module.exports = {
  name: "nameguesser",
  aliases: ["ng", "rng"],
  category: "Games",
  description: "A host-driven guessing game. Host provides images, players guess their own secret identity!",
  usage: "nameguesser [setup/join/leave/start/cancel/status]",
  run: async (client, message, args, prefix, config) => {
    registerNGListener(client);
    const subCommand = args[0]?.toLowerCase();
    let game = client.nameGuesserGames.get(message.channel.id);

    // DM Support: Find the game the user belongs to if in DMs
    if (!game && !message.guild) {
      game = Array.from(client.nameGuesserGames.values()).find(g => g.host === message.author.id || g.players.has(message.author.id));
    }

    // --- 1. SETUP COMMAND ---
    if (subCommand === 'setup') {
      if (game) return message.reply("⚠️ A NameGuesser session is already active in this channel.");
      
      const newGame = {
        host: message.author.id,
        hostName: message.author.username,
        channelId: message.channel.id,
        guildId: message.guild.id,
        status: 'SETUP_COLLECT', // Start with image collection
        prize: 0,
        images: [], // { url, buffer, name, assignedTo }
        players: new Map(), // userId -> { id, name, assignedImageIdx, wins: 0, ranked: null }
        winners: [],
        turnIdx: 0,
        currentQuestion: null,
        votes: new Map(),
        discussionMode: 'CHAT', // CHAT or VC
        setupMsgId: null
      };

      client.nameGuesserGames.set(message.channel.id, newGame);
      const engine = require('./engine.js');
      return engine.startSetup(client, message, newGame);
    }

    if (!game) {
      return message.reply(`🎮 Use \`${prefix}nameguesser setup\` to start a new game!`);
    }

    // --- 2. LOBBY COMMANDS ---
    if (game.status === 'LOBBY' || game.status === 'SETUP_PRIZE') {
      if (subCommand === 'join') {
        if (game.players.has(message.author.id)) return message.reply("⚠️ You are already in the lobby!");
        if (game.players.size >= game.images.length) return message.reply(`⚠️ The lobby is full! (Max players: ${game.images.length})`);
        
        game.players.set(message.author.id, { 
          id: message.author.id, 
          name: message.author.username, 
          assignedImageIdx: null,
          wins: 0,
          ranked: null
        });
        
        message.reply("✅ **Joined!** You'll be assigned a secret image once the game starts.");
        const engine = require('./engine.js');
        return engine.updateLobbyUI(client, game);
      }

      if (subCommand === 'leave') {
        if (!game.players.has(message.author.id)) return message.reply("⚠️ You aren't in this game.");
        game.players.delete(message.author.id);
        message.reply("👋 You left the game.");
        const engine = require('./engine.js');
        return engine.updateLobbyUI(client, game);
      }

      if (subCommand === 'start') {
        if (message.author.id !== game.host) return message.reply("❌ Only the Host can start the game!");
        if (game.players.size < 2) return message.reply("⚠️ You need at least 2 players to start!");
        if (game.status === 'SETUP_PRIZE') return message.reply("⚠️ Please set the prize pool in your DMs first!");
        
        const engine = require('./engine.js');
        return engine.startGame(client, game);
      }

      if (subCommand === 'cancel') {
        if (message.author.id !== game.host) return message.reply("❌ Only the Host can cancel the game!");
        
        if (game.prize > 0) {
          const token = getEconomyToken(client, game.guildId);
          await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${game.guildId}/users/${game.host}`, { cash: game.prize }, {
            headers: { 'Authorization': token }
          }).catch(err => console.error('Refund failed:', err.message));
        }

        client.nameGuesserGames.delete(game.channelId);
        return message.reply("⭕ Game cancelled and funds returned (if any).");
      }
    }

    // --- 3. IN-GAME COMMANDS ---
    if (game.status === 'RUNNING') {
      const engine = require('./engine.js');
      
      if (subCommand === 'status') {
        return engine.sendStatus(client, message, game);
      }

      if (subCommand === 'vote' || subCommand === 'v') {
        const choice = args[1]?.toLowerCase();
        if (choice !== 'yes' && choice !== 'no') return message.reply("❌ Usage: `ng vote [yes/no]`");
        return engine.handleVote(client, message, game, choice);
      }

      if (subCommand === 'guess' || subCommand === 'g') {
        const guess = args.slice(1).join(' ');
        if (!guess) return message.reply("❌ Usage: `ng guess [your guess]`");
        return engine.handleGuess(client, message, game, guess);
      }

      if (subCommand === 'force') {
        if (message.author.id !== game.host) return;
        const mode = args[1]?.toUpperCase();
        if (mode !== 'CHAT' && mode !== 'VC') return message.reply("❌ Usage: `ng force [CHAT/VC]`");
        game.discussionMode = mode;
        message.reply(`⚙️ **Host forced mode to:** ${mode}`);
        return engine.updateMainEmbed(client, game);
      }
    }
  }
};

function registerNGListener(client) {
  if (client.ngListenerRegistered) return;
  client.ngListenerRegistered = true;

  client.on('interactionCreate', async (i) => {
    if (!i.isButton() && !i.isStringSelectMenu()) return;
    
    const g = Array.from(client.nameGuesserGames.values()).find(game => game.host === i.user.id || game.players.has(i.user.id));
    if (!g) return;

    const engine = require('./engine.js');

    if (i.customId === 'ng_vote_yes') return engine.handleVote(client, i, g, 'yes');
    if (i.customId === 'ng_vote_no') return engine.handleVote(client, i, g, 'no');
    
    if (i.customId === 'ng_guess') {
      const modal = {
        title: 'Guess Your Identity',
        custom_id: 'ng_guess_modal',
        components: [{
          type: 1,
          components: [{
            type: 4,
            custom_id: 'guess_input',
            label: 'What is your guess?',
            style: 1,
            placeholder: 'Type the name here...',
            min_length: 1,
            max_length: 100,
            required: true
          }]
        }]
      };
      // Use raw interaction show modal because discord.js v14 ModalBuilder is easier but let's use what's available
      return i.showModal(modal);
    }

    if (i.customId.startsWith('ng_validate_win_')) {
      const playerId = i.customId.replace('ng_validate_win_', '');
      const player = g.players.get(playerId);
      i.update({ content: `✅ You validated **${player.name}** as a winner.`, components: [] });
      return engine.markWinner(client, g, player);
    }
    
    if (i.customId.startsWith('ng_validate_fail_')) {
      const playerId = i.customId.replace('ng_validate_fail_', '');
      const player = g.players.get(playerId);
      i.update({ content: `❌ You rejected **${player.name}**'s guess.`, components: [] });
      const channel = await client.channels.fetch(g.channelId);
      channel.send(`⚖️ **Host rejected the guess from ${player.name}.** Keep trying!`);
      g.turnIdx++;
      return engine.startTurn(client, g);
    }

    if (i.customId === 'ng_toggle_mode') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      g.discussionMode = g.discussionMode === 'VC' ? 'CHAT' : 'VC';
      i.reply({ content: `⚙️ Mode toggled to **${g.discussionMode}**`, flags: [MessageFlags.Ephemeral] });
      const channel = await client.channels.fetch(g.channelId);
      const turnMsg = await channel.messages.fetch(g.currentTurnMsgId).catch(() => null);
      if (turnMsg) {
        const embed = new EmbedBuilder(turnMsg.embeds[0].data);
        const fieldIdx = embed.data.fields.findIndex(f => f.name === 'Discussion Mode');
        if (fieldIdx !== -1) embed.data.fields[fieldIdx].value = g.discussionMode === 'VC' ? '🎙️ Voice Channel' : '💬 Chat Channel';
        await turnMsg.edit({ embeds: [embed] }).catch(() => {});
      }
    }
  });

  client.on('interactionCreate', async (i) => {
    if (!i.isModalSubmit()) return;
    if (i.customId === 'ng_guess_modal') {
      const g = Array.from(client.nameGuesserGames.values()).find(game => game.players.has(i.user.id));
      if (!g) return;
      const guess = i.fields.getTextInputValue('guess_input');
      const engine = require('./engine.js');
      return engine.handleGuess(client, i, g, guess);
    }
  });
}
