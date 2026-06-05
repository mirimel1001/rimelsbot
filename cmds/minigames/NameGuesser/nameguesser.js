const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { getEconomyToken, formatNumber } = require('../../../utils/economy.js');
const NameGuesserLog = require('../../../models/NameGuesserLog.js');

module.exports = {
  name: "nameguesser",
  aliases: ["ng", "rng"],
  category: "Games",
  description: "A host-driven guessing game. Host provides images, players guess their own secret identity!",
  usage: "nameguesser [setup/join/leave/start/cancel/status/history/identities/kick]",
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
        currentRound: 1,
        consecutiveYesCount: 0,
        activePlayerId: null,
        currentQuestion: null,
        votes: new Map(),
        discussionMode: 'CHAT', // CHAT or VC
        setupMsgId: null,
        history: [],
        dmLogMsgIds: new Map(), // userId -> [msgId1, msgId2, ...]
        channelLogMsgIds: []    // [msgId1, msgId2, ...]
      };

      client.nameGuesserGames.set(message.channel.id, newGame);
      const engine = require('./engine.js');
      return engine.startSetup(client, message, newGame);
    }

    // --- HISTORY COMMAND (DB Query, works even when game is over) ---
    if (subCommand === 'history' || subCommand === 'hist' || subCommand === 'h' || subCommand === 'logs') {
      const channelId = message.channel.id || game?.channelId;
      if (!channelId) return message.reply("❌ This command must be run in a server channel.");

      const log = await NameGuesserLog.findOne({ channelId }).sort({ createdAt: -1 });
      if (!log) {
        return message.reply("❌ No game logs found for this channel. Note: Logs are deleted 30 minutes after the game ends.");
      }

      const targetUser = message.mentions.users.first();
      
      if (targetUser) {
        const playerHistory = log.history.filter(e => e.playerId === targetUser.id);
        if (playerHistory.length === 0) {
          return message.reply(`🔍 No questions/guesses found for **${targetUser.username}** in this match.`);
        }

        let text = `📜 **Questions & Guesses for ${targetUser.username} (Game ${log.status}):**\n\n`;
        playerHistory.forEach((e, idx) => {
          if (e.type === 'QUESTION') {
            text += `❓ **Q${idx+1}:** "${e.text}"\nResult: ${e.result} (Majority: ${e.majority} | Host: ${e.host})\n\n`;
          } else if (e.type === 'GUESS') {
            text += `🎯 **Guess:** "${e.text}"\nResult: ${e.result} (Host: ${e.host})\n\n`;
          }
        });
        const embed = new EmbedBuilder().setColor('#3498DB').setDescription(text.substring(0, 4096));
        return message.reply({ embeds: [embed] });
      } else {
        let text = `📜 **Complete Game History (Game ${log.status}):**\n\n`;
        log.history.forEach((e, idx) => {
          if (e.type === 'QUESTION') {
            text += `❓ **Question from ${e.player}:** "${e.text}"\nResult: ${e.result}\n\n`;
          } else if (e.type === 'GUESS') {
            text += `🎯 **Guess from ${e.player}:** "${e.text}"\nResult: ${e.result}\n\n`;
          } else if (e.type === 'KICK') {
            text += `❌ **${e.player}** was kicked by Host.\n\n`;
          }
        });
        if (log.history.length === 0) text += "No actions logged yet.";
        
        const embed = new EmbedBuilder().setColor('#3498DB').setDescription(text.substring(0, 4096));
        return message.reply({ embeds: [embed] });
      }
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
    }

    // --- IDENTITIES/LIST COMMAND ---
    if (subCommand === 'identities' || subCommand === 'list' || subCommand === 'secret' || subCommand === 'secrets') {
      if (game.status !== 'RUNNING') {
        return message.reply("⚠️ There is no active game running.");
      }

      const isHost = message.author.id === game.host;
      const isPlayer = game.players.has(message.author.id);

      if (!isHost && !isPlayer) {
        return message.reply("❌ You are not a participant in this game.");
      }

      const embed = new EmbedBuilder().setColor('#3498DB');

      if (isHost) {
        embed.setTitle('👑 Host: Game Identities');
        const list = Array.from(game.players.values()).map(p => {
          const img = game.images[p.assignedImageIdx];
          return `👤 **${p.name}** is: **${img.name}**`;
        }).join('\n') || "No players assigned.";
        embed.setDescription(list);
        await message.author.send({ embeds: [embed] }).catch(() => {});
        if (message.guild) {
          return message.reply("📥 Sent the full identity list to your DMs.");
        }
        return;
      } else {
        embed.setTitle('🎭 Secret Identities of Other Players');
        const list = Array.from(game.players.values())
          .filter(p => p.id !== message.author.id)
          .map(p => {
            const img = game.images[p.assignedImageIdx];
            return `👤 **${p.name}** is: **${img.name}**`;
          }).join('\n') || "No other players.";
        embed.setDescription(list + "\n\n*(Your own identity is hidden!)*");
        await message.author.send({ embeds: [embed] }).catch(() => {});
        if (message.guild) {
          return message.reply("📥 Sent the identities of all other players to your DMs.");
        }
        return;
      }
    }

    // --- KICK COMMAND ---
    if (subCommand === 'kick') {
      if (message.author.id !== game.host) return message.reply("❌ Only the Host can kick players!");
      const target = message.mentions.users.first() || (args[1] ? await client.users.fetch(args[1]).catch(() => null) : null);
      if (!target) return message.reply("❌ Please specify a player to kick. Usage: `ng kick <@player>`");

      if (!game.players.has(target.id)) {
        return message.reply("⚠️ That user is not in this game.");
      }

      const engine = require('./engine.js');
      await engine.kickPlayer(client, game, target.id);
      return message.reply(`✅ **${target.username}** has been kicked from the game.`);
    }

    // --- 3. GLOBAL COMMANDS ---
    if (subCommand === 'cancel') {
      if (message.author.id !== game.host) return message.reply("❌ Only the Host can cancel the game!");
      
      const { refundFunds } = require('../../../utils/economy.js');
      if (game.prize > 0) {
        await refundFunds(client, game.guildId, game.host, game.prize).catch(err => console.error('Refund failed:', err.message));
      }

      client.nameGuesserGames.delete(game.channelId);
      return message.reply("⭕ Session cancelled and funds returned (if any).");
    }

    if (subCommand === 'launch') {
      if (message.author.id !== game.host) return message.reply("❌ Only the Host can launch the lobby!");
      if (game.status === 'LOBBY') return message.reply("⚠️ Lobby is already launched.");
      const engine = require('./engine.js');
      message.reply("🚀 **Lobby launched!**");
      return engine.launchLobby(client, game);
    }

    if (subCommand === 'edit') {
      if (message.author.id !== game.host) return message.reply("❌ Host only.");
      const { refundFunds } = require('../../../utils/economy.js');
      if (game.prize > 0) {
        await refundFunds(client, game.guildId, game.host, game.prize).catch(err => console.error('Refund failed:', err.message));
        game.prize = 0;
      }
      const engine = require('./engine.js');
      message.reply("🔄 **Resetting prize pool...** Check your DMs.");
      return engine.promptPrize(client, game);
    }

    if (subCommand === 'add') {
      if (message.author.id !== game.host) return message.reply("❌ Host only.");
      const engine = require('./engine.js');
      message.reply("🖼️ **Ready to add more images in DMs.**");
      return engine.startSetup(client, null, game);
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
        return engine.updateLog(client, game);
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

    if (i.customId === 'ng_cancel_setup') {
      if (i.user.id !== g.host) return i.reply({ content: 'Only the host can cancel the session.', flags: [MessageFlags.Ephemeral] });
      
      const { refundFunds } = require('../../../utils/economy.js');
      if (g.prize > 0) {
        await refundFunds(client, g.guildId, g.host, g.prize).catch(err => console.error('Refund failed:', err.message));
      }

      client.nameGuesserGames.delete(g.channelId);
      return i.update({ content: '⭕ **Session cancelled.** Any funds have been returned.', embeds: [], components: [] });
    }

    if (i.customId === 'ng_launch_lobby') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      i.update({ content: `🚀 **Lobby launched!** Check the game channel: <#${g.channelId}>`, embeds: [], components: [] });
      return engine.launchLobby(client, g);
    }

    if (i.customId === 'ng_edit_prize') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      
      const { refundFunds } = require('../../../utils/economy.js');
      if (g.prize > 0) {
        await refundFunds(client, g.guildId, g.host, g.prize).catch(err => console.error('Refund failed:', err.message));
        g.prize = 0;
      }
      
      if (i.guild) {
        i.reply({ content: '📥 Check your DMs to set the new prize.', flags: [MessageFlags.Ephemeral] });
      } else {
        i.update({ content: '🔄 Resetting prize pool...', embeds: [], components: [] });
      }
      return engine.promptPrize(client, g);
    }

    if (i.customId === 'ng_edit_names') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      
      const { StringSelectMenuBuilder, StringSelectMenuOptionBuilder } = require('discord.js');
      const select = new StringSelectMenuBuilder()
        .setCustomId('ng_select_edit_image')
        .setPlaceholder('Select an image to rename')
        .addOptions(g.images.map((img, idx) => 
          new StringSelectMenuOptionBuilder().setLabel(`Image #${idx + 1}`).setDescription(img.name).setValue(idx.toString())
        ));

      return i.reply({ content: 'Select which identity you want to rename:', components: [new ActionRowBuilder().addComponents(select)], flags: [MessageFlags.Ephemeral] });
    }

    if (i.customId === 'ng_select_edit_image') {
      const index = parseInt(i.values[0]);
      await i.update({ content: '🔄 Opening edit prompt in DMs...', components: [] });
      return engine.promptEditName(client, g, index);
    }
    
    if (i.customId.startsWith('ng_validate_')) {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      return engine.handleValidation(client, i, g);
    }
    
    if (i.customId === 'ng_ask') {
      if (i.user.id !== g.activePlayerId) return i.reply({ content: "It's not your turn!", flags: [MessageFlags.Ephemeral] });
      
      const modal = {
        title: 'Ask a Question',
        customId: 'ng_ask_modal',
        components: [
          {
            type: 1,
            components: [
              {
                type: 4,
                customId: 'question_text',
                label: 'Your Yes/No Question',
                style: 1,
                placeholder: 'e.g. Am I a human?',
                min_length: 3,
                max_length: 200,
                required: true
              }
            ]
          }
        ]
      }
      return i.showModal(modal);
    }

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
      return i.showModal(modal);
    }

    if (i.customId === 'ng_toggle_mode') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      g.discussionMode = g.discussionMode === 'VC' ? 'CHAT' : 'VC';
      i.reply({ content: `⚙️ Mode toggled to **${g.discussionMode}**`, flags: [MessageFlags.Ephemeral] });
      return engine.updateLog(client, g);
    }
  });

  client.on('interactionCreate', async (i) => {
    if (!i.isModalSubmit()) return;
    if (i.customId === 'ng_ask_modal') {
      const g = client.nameGuesserGames.get(i.channel?.id) || Array.from(client.nameGuesserGames.values()).find(x => x.activePlayerId === i.user.id);
      if (!g) return;
      const question = i.fields.getTextInputValue('question_text');
      await i.reply({ content: '📤 Question submitted!', flags: [MessageFlags.Ephemeral] });
      const engine = require('./engine.js');
      return engine.processQuestion(client, g, question);
    }

    if (i.customId === 'ng_guess_modal') {
      const g = Array.from(client.nameGuesserGames.values()).find(game => game.players.has(i.user.id));
      if (!g) return;
      const guess = i.fields.getTextInputValue('guess_input');
      const engine = require('./engine.js');
      return engine.handleGuess(client, i, g, guess);
    }
  });
}
