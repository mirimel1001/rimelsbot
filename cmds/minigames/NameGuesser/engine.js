const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { formatNumber, getEconomyToken } = require('../../../utils/economy.js');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

module.exports = {
  startSetup: async (client, message, game) => {
    const host = await client.users.fetch(game.host);
    if (game.images.length === 0) {
      const setupEmbed = new EmbedBuilder().setColor('#3498DB').setTitle('🖼️ Name Guesser: Setup').setDescription('Please upload images one by one or in bulk in this DM.\n\nType **done** when you are finished uploading.');
      await host.send({ embeds: [setupEmbed] });
      return module.exports.collectImages(client, game);
    } else return module.exports.setupReview(client, game);
  },

  collectImages: async (client, game) => {
    const host = await client.users.fetch(game.host);
    const filter = m => m.author.id === game.host && (m.attachments.size > 0 || m.content.toLowerCase() === 'done' || m.content.toLowerCase() === 'stop');
    const collector = host.dmChannel.createMessageCollector({ filter, time: 600000 });
    collector.on('collect', async m => {
      if (m.content.toLowerCase() === 'done' || m.content.toLowerCase() === 'stop') { collector.stop('done'); return; }
      if (m.attachments.size === 0) return m.reply("⚠️ Please upload images or type `done`.");
      let addedCount = 0;
      m.attachments.forEach(attachment => { game.images.push({ url: attachment.url, name: 'Unnamed', assignedTo: null }); addedCount++; });
      m.reply(`✅ Added **${addedCount}** images (${game.images.length} total). Type \`done\` when finished.`);
    });
    collector.on('end', (collected, reason) => {
      if (game.images.length < 2) return host.send("⚠️ You need at least 2 images to start setup.");
      return module.exports.sequentialNaming(client, game, 0);
    });
  },

  sequentialNaming: async (client, game, index) => {
    const host = await client.users.fetch(game.host);
    if (index >= game.images.length) return module.exports.promptPrize(client, game);
    const img = game.images[index];
    const embed = new EmbedBuilder().setColor('#3498DB').setTitle(`🏷️ Name Identity: ${index + 1} / ${game.images.length}`).setDescription('Please reply with the name for this image identity.').setImage(img.url);
    await host.send({ embeds: [embed] });
    const collector = host.dmChannel.createMessageCollector({ filter: m => m.author.id === game.host, max: 1, time: 60000 });
    collector.on('collect', m => { game.images[index].name = m.content; return module.exports.sequentialNaming(client, game, index + 1); });
  },

  promptPrize: async (client, game) => {
    const host = await client.users.fetch(game.host);
    const embed = new EmbedBuilder().setColor('#F1C40F').setTitle('💰 Set Prize Pool').setDescription('How much cash do you want to put in the pot?');
    await host.send({ embeds: [embed] });
    const collector = host.dmChannel.createMessageCollector({ filter: m => m.author.id === game.host && !isNaN(m.content), max: 1, time: 60000 });
    collector.on('collect', async m => {
      const amount = parseInt(m.content);
      const { deductFunds } = require('../../../utils/economy.js');
      if (!await deductFunds(client, game.guildId, game.host, amount)) { m.reply("❌ Insufficient wealth!"); return module.exports.promptPrize(client, game); }
      game.prize = amount;
      return module.exports.setupReview(client, game);
    });
  },

  setupReview: async (client, game) => {
    const host = await client.users.fetch(game.host);
    const embed = new EmbedBuilder().setColor('#2ECC71').setTitle('📝 Name Guesser: Review').setDescription(`🖼️ **Images:** ${game.images.length}\n💰 **Prize Pool:** ${formatNumber(game.prize)}\n\n**Identities:**\n${game.images.map((img, i) => `${i + 1}. **${img.name}**`).join('\n')}`).setFooter({ text: 'Manual: ng launch, ng edit, ng add, ng cancel' });
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ng_launch_lobby').setLabel('Launch Lobby').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ng_edit_names').setLabel('Edit Names').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ng_edit_prize').setLabel('Edit Prize').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('ng_cancel_setup').setLabel('Cancel Setup').setStyle(ButtonStyle.Danger)
    );
    await host.send({ embeds: [embed], components: [row] });
  },

  promptEditName: async (client, game, index) => {
    const host = await client.users.fetch(game.host);
    const img = game.images[index];
    const embed = new EmbedBuilder().setColor('#3498DB').setTitle(`✏️ Edit Identity: #${index + 1}`).setDescription(`Current: **${img.name}**\nReply with new name.`).setImage(img.url);
    await host.send({ embeds: [embed] });
    const collector = host.dmChannel.createMessageCollector({ filter: m => m.author.id === game.host, max: 1, time: 60000 });
    collector.on('collect', m => { game.images[index].name = m.content; return module.exports.setupReview(client, game); });
  },

  launchLobby: async (client, game) => { game.status = 'LOBBY'; return module.exports.updateLobbyUI(client, game); },

  updateLobbyUI: async (client, game) => {
    const channel = await client.channels.fetch(game.channelId);
    const embed = new EmbedBuilder().setColor('#9B59B6').setTitle('🎮 Name Guesser: Lobby').setDescription(`Host: **${game.hostName}**\nPrize: 💰 ${formatNumber(game.prize)}\nPlayers: ${game.players.size} / ${game.images.length}`).addFields({ name: 'Players', value: Array.from(game.players.values()).map(p => `• ${p.name}`).join('\n') || 'None' }).setFooter({ text: 'Manual: ng join, ng leave, ng start, ng edit, ng cancel' });
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ng_join').setLabel('Join').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('ng_leave').setLabel('Leave').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('ng_start').setLabel('Start Game').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('ng_lobby_edit').setLabel('Edit Prize').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('ng_cancel_lobby').setLabel('Cancel Game').setStyle(ButtonStyle.Danger));
    if (game.lobbyMsgId) { const oldMsg = await channel.messages.fetch(game.lobbyMsgId).catch(() => null); if (oldMsg) await oldMsg.delete().catch(() => {}); }
    game.lobbyMsgId = (await channel.send({ embeds: [embed], components: [row] })).id;
  },

  startGame: async (client, game) => {
    if (game.players.size < 2) return;
    game.status = 'RUNNING';
    const players = Array.from(game.players.values());
    const shuffledImages = [...game.images].sort(() => Math.random() - 0.5);
    for (let i = 0; i < players.length; i++) players[i].assignedImageIdx = game.images.indexOf(shuffledImages[i]);
    for (const p of players) {
      const user = await client.users.fetch(p.id);
      const others = players.filter(op => op.id !== p.id);
      const embeds = [new EmbedBuilder().setColor('#9B59B6').setTitle('🎭 Secret Identities').setDescription('Goal: Ask Yes/No questions to figure out who YOU are!')];
      for (const op of others) {
        const img = game.images[op.assignedImageIdx];
        embeds.push(new EmbedBuilder().setColor('#3498DB').setTitle(`👤 ${op.name}`).setDescription(`**${op.name}** is: **${img.name}**`).setImage(img.url));
      }
      await user.send({ embeds: embeds.slice(0, 10) }).catch(() => {});
    }
    const hostUser = await client.users.fetch(game.host);
    const hostEmbeds = [new EmbedBuilder().setColor('#F1C40F').setTitle('👑 Host: Game Identities')];
    for (const p of players) {
      const img = game.images[p.assignedImageIdx];
      hostEmbeds.push(new EmbedBuilder().setColor('#3498DB').setTitle(`👤 ${p.name}`).setDescription(`**${p.name}** is: **${img.name}**`).setImage(img.url));
    }
    await hostUser.send({ embeds: hostEmbeds.slice(0, 10) }).catch(() => {});
    return module.exports.startTurn(client, game);
  },

  updateLog: async (client, game) => {
    let historyText = '';
    for (const e of game.history) {
      if (e.type === 'QUESTION') historyText += `❓ **Question from ${e.player}:** "${e.text}"\nMajority: ${e.majority} | Host: ${e.host} | Result: ${e.result}\n\n`;
      else historyText += `🎯 **Guess from ${e.player}:** "${e.text}"\nHost: ${e.host} | Result: ${e.result}\n\n`;
    }

    let activeComponents = [];
    const activePlayer = game.players.get(game.activePlayerId);

    if (game.status === 'RUNNING') {
      if (game.currentQuestion) {
        historyText += `⁉️ **Current Question from ${activePlayer.name}:** "${game.currentQuestion}"\n`;
        const yesCount = Array.from(game.votes.values()).filter(v => v === 'yes').length;
        const noCount = Array.from(game.votes.values()).filter(v => v === 'no').length;
        historyText += `Majority: ${yesCount > noCount ? 'Yes' : (noCount > yesCount ? 'No' : 'Undecided')} | Host: ${game.hostDecision === 'yes' ? 'Yes' : (game.hostDecision === 'no' ? 'No' : 'Undecided')} | Result: Undecided\n`;
        activeComponents.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ng_vote_yes').setLabel('Yes').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('ng_vote_no').setLabel('No').setStyle(ButtonStyle.Danger)));
      }
    } else if (game.status === 'VALIDATION') {
      const target = game.players.get(game.validatingPlayerId);
      historyText += `🎯 **Current Guess from ${target.name}:** "${game.lastGuess}"\nHost: Validating... | Result: Undecided\n`;
    } else if (game.status === 'ENDED') {
      historyText += `\n🏁 **GAME OVER**\n**Pot:** 💰 ${formatNumber(game.prize)}\n**Payouts:**\n`;
      const winnerCount = game.winners.length;
      const firstPrize = winnerCount === 1 ? game.prize : Math.floor(game.prize * 0.5);
      const restPrize = winnerCount > 1 ? Math.floor((game.prize - firstPrize) / (winnerCount - 1)) : 0;
      game.winners.forEach((id, idx) => {
        historyText += `${idx + 1}. **${game.players.get(id).name}** (+💰 ${formatNumber(idx === 0 ? firstPrize : restPrize)})\n`;
      });
    }

    const mainEmbed = new EmbedBuilder().setColor(game.status === 'ENDED' ? '#2ECC71' : '#9B59B6').setTitle(game.status === 'ENDED' ? '🏁 Name Guesser: Game Over' : '📜 Name Guesser: Game Log').setDescription(historyText || 'No history yet.');
    if (game.lastStatus) mainEmbed.setAuthor({ name: game.lastStatus.replace(/\*/g, '') });

    // Footer with fallback commands
    let footerText = 'Manual cmds: ';
    if (game.status === 'RUNNING') {
      if (game.currentQuestion) footerText += 'ng vote [yes/no]';
      else footerText += 'ng ask [question], ng guess [identity]';
    } else if (game.status === 'VALIDATION') footerText += 'Host: ng validate [win/fail]';
    else if (game.status === 'LOBBY') footerText += 'ng join, ng leave, ng start';
    mainEmbed.setFooter({ text: footerText });

    const recipients = Array.from(game.players.keys());
    if (!recipients.includes(game.host)) recipients.push(game.host);

    try {
      const channel = await client.channels.fetch(game.channelId);
      const content = (game.status === 'RUNNING' && !game.currentQuestion) ? `<@${game.activePlayerId}>` : '';
      if (game.channelLogMsgIds[0]) {
        const msg = await channel.messages.fetch(game.channelLogMsgIds[0]).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      }
      game.channelLogMsgIds[0] = (await channel.send({ content, embeds: [mainEmbed], components: activeComponents })).id;
    } catch (e) {}

    for (const id of recipients) {
      try {
        const user = await client.users.fetch(id);
        let userComponents = [];
        if (game.status === 'VALIDATION' && id === game.host) userComponents.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ng_validate_win_${game.validatingPlayerId}`).setLabel('Valid (Win)').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`ng_validate_fail_${game.validatingPlayerId}`).setLabel('Invalid').setStyle(ButtonStyle.Danger)));
        else if (game.currentQuestion) {
          if (id === game.host) userComponents.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ng_vote_yes').setLabel('Host Yes').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId('ng_vote_no').setLabel('Host No').setStyle(ButtonStyle.Danger)));
          else if (id !== game.activePlayerId) userComponents.push(activeComponents[0]);
        }
        let userMsgIds = game.dmLogMsgIds.get(id) || [];
        if (userMsgIds[0]) {
          const msg = await user.dmChannel?.messages.fetch(userMsgIds[0]).catch(() => null);
          if (msg) await msg.delete().catch(() => {});
        }
        userMsgIds[0] = (await user.send({ embeds: [mainEmbed], components: userComponents })).id;
        game.dmLogMsgIds.set(id, userMsgIds);
      } catch (e) {}
    }
  },

  startTurn: async (client, game) => {
    const players = Array.from(game.players.values()).filter(p => p.ranked === null);
    if (players.length <= 1) return module.exports.endGame(client, game);
    
    // Safety check for turnIdx
    if (game.turnIdx >= players.length) game.turnIdx = 0;
    
    const activePlayer = players[game.turnIdx % players.length];
    game.activePlayerId = activePlayer.id;
    game.status = 'RUNNING';
    game.consecutiveYesCount = 0; 

    try {
      const user = await client.users.fetch(game.activePlayerId);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ng_ask').setLabel('Ask Question').setStyle(ButtonStyle.Primary), 
        new ButtonBuilder().setCustomId('ng_guess').setLabel('Guess Identity').setStyle(ButtonStyle.Success)
      );
      game.currentTurnMsgId = (await user.send({ content: `🎲 **It's your turn, ${activePlayer.name}!** Ask a question or make a guess.`, components: [row] })).id;
    } catch (e) {}
    return module.exports.updateLog(client, game);
  },

  processQuestion: async (client, game, question) => {
    game.currentQuestion = question;
    game.votes.clear();
    game.hostDecision = 'none';
    game.lastStatus = `❓ Question Asked by ${game.players.get(game.activePlayerId).name}`;
    if (game.currentTurnMsgId) {
      const user = await client.users.fetch(game.activePlayerId);
      const msg = await user.dmChannel?.messages.fetch(game.currentTurnMsgId).catch(() => null);
      if (msg) await msg.delete().catch(() => null);
    }
    return module.exports.updateLog(client, game);
  },

  handleVote: async (client, interaction, game, choice) => {
    if (interaction.user.id === game.activePlayerId) return interaction.reply({ content: "You can't vote on your own!", flags: [MessageFlags.Ephemeral] });
    if (interaction.user.id === game.host) { game.hostDecision = choice; interaction.reply({ content: `✅ Decided: **${choice.toUpperCase()}**`, flags: [MessageFlags.Ephemeral] }); }
    else { game.votes.set(interaction.user.id, choice); interaction.reply({ content: `✅ Voted **${choice.toUpperCase()}**`, flags: [MessageFlags.Ephemeral] }); }
    if (game.votes.size >= Array.from(game.players.values()).filter(p => p.id !== game.activePlayerId).length) module.exports.resolveRound(client, game);
    else return module.exports.updateLog(client, game);
  },

  resolveRound: async (client, game) => {
    const votes = Array.from(game.votes.values());
    const yesCount = votes.filter(v => v === 'yes').length;
    const noCount = votes.filter(v => v === 'no').length;
    const finalResult = game.hostDecision !== 'none' ? game.hostDecision : (yesCount > noCount ? 'yes' : 'no');
    
    game.history.push({ 
      type: 'QUESTION', 
      player: game.players.get(game.activePlayerId).name, 
      text: game.currentQuestion, 
      majority: yesCount > noCount ? 'Yes' : 'No', 
      host: game.hostDecision !== 'none' ? (game.hostDecision === 'yes' ? 'Yes' : 'No') : 'No Override', 
      result: finalResult === 'yes' ? '✅ YES' : '❌ NO' 
    });

    game.currentQuestion = null; 
    game.votes.clear(); 
    game.hostDecision = 'none';

    if (finalResult === 'yes') {
      game.consecutiveYesCount++;
      if (game.consecutiveYesCount >= 3) {
        game.lastStatus = `🔄 3 Yes answers in a row! Moving to next player.`;
        game.turnIdx++;
        return module.exports.startTurn(client, game);
      }
      game.lastStatus = `🔄 Correct! ${game.players.get(game.activePlayerId).name} gets another turn.`;
      return module.exports.startTurn(client, game);
    } else {
      game.lastStatus = `⏭️ Incorrect. Moving to next player.`;
      game.turnIdx++;
      return module.exports.startTurn(client, game);
    }
  },

  handleGuess: async (client, interaction, game, guess) => {
    const player = game.players.get(interaction.user.id);
    game.lastGuess = guess;
    if (game.currentTurnMsgId) {
      const user = await client.users.fetch(player.id);
      const msg = await user.dmChannel?.messages.fetch(game.currentTurnMsgId).catch(() => null);
      if (msg) await msg.delete().catch(() => null);
    }
    const img = game.images[player.assignedImageIdx];
    if (guess.toLowerCase().trim() === img.name.toLowerCase().trim()) {
      interaction.reply({ content: `🎉 **BINGO!**`, flags: [MessageFlags.Ephemeral] });
      game.history.push({ type: 'GUESS', player: player.name, text: guess, host: '✅ Auto-Match', result: '🏆 WIN!' });
      game.lastStatus = `🏆 WINNER! ${player.name} guessed right!`;
      return module.exports.markWinner(client, game, player);
    } else {
      interaction.reply({ content: "📤 Sent to Host for validation.", flags: [MessageFlags.Ephemeral] });
      game.status = 'VALIDATION'; game.validatingPlayerId = player.id; game.lastStatus = `⚖️ Host is checking ${player.name}'s guess...`;
      return module.exports.updateLog(client, game);
    }
  },

  handleValidation: async (client, i, game) => {
    const isWin = i.customId.startsWith('ng_validate_win_');
    const player = game.players.get(game.validatingPlayerId);
    if (isWin) {
      game.history.push({ type: 'GUESS', player: player.name, text: game.lastGuess, host: '✅ Validated', result: '🏆 WIN!' });
      game.lastStatus = `🏆 WINNER! ${player.name} guessed right!`;
      await i.update({ content: `✅ Validated.`, components: [] }).catch(() => {});
      return module.exports.markWinner(client, game, player);
    } else {
      game.history.push({ type: 'GUESS', player: player.name, text: game.lastGuess, host: '❌ Rejected', result: '🔄 Keep Playing' });
      game.lastStatus = `❌ Guess Rejected for ${player.name}.`;
      await i.update({ content: `❌ Rejected.`, components: [] }).catch(() => {});
      game.turnIdx++; return module.exports.startTurn(client, game);
    }
  },

  markWinner: async (client, game, player) => {
    if (player.ranked !== null) return;
    player.ranked = game.winners.length + 1;
    game.winners.push(player.id);
    
    // REVELATION
    const img = game.images[player.assignedImageIdx];
    const revEmbed = new EmbedBuilder().setColor('#F1C40F').setTitle(`🎉 ${player.name} guessed correctly!`).setDescription(`Their identity was: **${img.name}**`).setImage(img.url);
    const channel = await client.channels.fetch(game.channelId);
    await channel.send({ content: `<@${player.id}>`, embeds: [revEmbed] });
    const user = await client.users.fetch(player.id);
    await user.send({ embeds: [revEmbed] }).catch(() => {});

    if (Array.from(game.players.values()).filter(p => p.ranked === null).length <= 1) return module.exports.endGame(client, game);
    
    // If we increment turnIdx here while a player is removed, we might skip someone.
    // However, our startTurn logic uses % length and a safety reset.
    // Let's ensure turnIdx is handled safely.
    if (game.turnIdx >= Array.from(game.players.values()).filter(p => p.ranked === null).length) {
      game.turnIdx = 0;
    }
    
    return module.exports.startTurn(client, game);
  },

  endGame: async (client, game) => {
    game.status = 'ENDED';
    await module.exports.updateLog(client, game);
    const token = getEconomyToken(client, game.guildId);
    const winnerCount = game.winners.length;
    const firstPrize = winnerCount === 1 ? game.prize : Math.floor(game.prize * 0.5);
    const restPrize = winnerCount > 1 ? Math.floor((game.prize - firstPrize) / (winnerCount - 1)) : 0;
    for (let i = 0; i < game.winners.length; i++) {
      const payout = i === 0 ? firstPrize : restPrize;
      if (payout > 0) {
        await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${game.guildId}/users/${game.winners[i]}`, { cash: payout }, { headers: { 'Authorization': token } }).catch(() => {});
        const { enforceMaxBalance } = require('../../../utils/economy.js');
        await enforceMaxBalance(client, game.guildId, game.winners[i]);
      }
    }
    client.nameGuesserGames.delete(game.channelId);
  }
};
