const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');
const { getEconomyToken, formatNumber } = require('../../../utils/economy.js');

module.exports = {
  startSetup: async (client, message, game) => {
    try {
      const host = await client.users.fetch(game.host);
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🖼️ Name Guesser: Setup Phase')
        .setDescription('Please upload the images you want to use for the game (one by one or multiple at once).\n\nType **"done"** once you have uploaded all images.')
        .setFooter({ text: 'The number of images determines the max player count.' });

      await host.send({ embeds: [embed] });
      game.status = 'SETUP_COLLECT';
      
      const filter = m => m.author.id === game.host && (m.attachments.size > 0 || m.content.toLowerCase() === 'done');
      const collector = host.dmChannel.createMessageCollector({ filter, time: 300000 });

      collector.on('collect', async (m) => {
        if (m.content.toLowerCase() === 'done') {
          if (game.images.length < 2) return m.reply("⚠️ You need at least 2 images to start!");
          collector.stop();
          return module.exports.startTitling(client, game);
        }

        for (const [id, attachment] of m.attachments) {
          if (attachment.contentType?.startsWith('image/')) {
            try {
              const res = await axios.get(attachment.url, { responseType: 'arraybuffer' });
              game.images.push({
                url: attachment.url,
                buffer: Buffer.from(res.data),
                name: null,
                assignedTo: null
              });
              m.react('✅');
            } catch (err) {
              m.reply(`❌ Failed to download image: ${attachment.name}`);
            }
          }
        }
      });
    } catch (err) {
      message.reply("❌ I couldn't DM the host. Please ensure your DMs are open!");
      client.nameGuesserGames.delete(game.channelId);
    }
  },

  startTitling: async (client, game) => {
    game.status = 'SETUP_TITLING';
    const host = await client.users.fetch(game.host);
    
    let currentIdx = 0;
    const askTitle = async () => {
      if (currentIdx >= game.images.length) {
        return module.exports.promptPrize(client, game);
      }

      const img = game.images[currentIdx];
      const attachment = new AttachmentBuilder(img.buffer, { name: `img_${currentIdx}.png` });
      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle(`🏷️ Title Image ${currentIdx + 1}/${game.images.length}`)
        .setDescription('What is the secret name for this image? (e.g., "Leonardo DiCaprio", "African Elephant")')
        .setImage(`attachment://img_${currentIdx}.png`);

      await host.send({ embeds: [embed], files: [attachment] });

      const filter = m => m.author.id === game.host && m.content.length > 0;
      const response = await host.dmChannel.awaitMessages({ filter, max: 1, time: 60000 });
      
      if (response.size === 0) {
        host.send("⏰ Timeout. Game cancelled.");
        return client.nameGuesserGames.delete(game.channelId);
      }

      img.name = response.first().content.trim();
      currentIdx++;
      askTitle();
    };

    askTitle();
  },

  promptPrize: async (client, game) => {
    game.status = 'SETUP_PRIZE';
    const host = await client.users.fetch(game.host);
    
    const embed = new EmbedBuilder()
      .setColor('#F1C40F')
      .setTitle('💰 Set Prize Pool')
      .setDescription('How much cash do you want to put in the pot? (Requires linked UnbelievaBoat balance)')
      .setFooter({ text: 'The prize will be split among winners (1st place gets more).' });

    await host.send({ embeds: [embed] });

    const filter = m => m.author.id === game.host && !isNaN(m.content.replace(/[,kmb]/g, ''));
    const response = await host.dmChannel.awaitMessages({ filter, max: 1, time: 60000 });

    if (response.size === 0) {
      host.send("⏰ Timeout. Game cancelled.");
      return client.nameGuesserGames.delete(game.channelId);
    }

    const { parseShorthand } = require('../../../utils/economy.js');
    const prize = parseShorthand(response.first().content);
    
    if (prize < 0) return host.send("❌ Invalid amount.");

    const token = getEconomyToken(client, game.guildId);
    try {
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${game.guildId}/users/${game.host}`, { cash: -prize }, {
        headers: { 'Authorization': token }
      });
      game.prize = prize;
      host.send(`✅ Prize pool set to **${formatNumber(prize)}**!`);
      
      return module.exports.launchLobby(client, game);
    } catch (err) {
      host.send("❌ Failed to deduct funds. Ensure you have enough cash in UnbelievaBoat!");
      return client.nameGuesserGames.delete(game.channelId);
    }
  },

  launchLobby: async (client, game) => {
    game.status = 'LOBBY';
    const channel = await client.channels.fetch(game.channelId);
    
    const embed = new EmbedBuilder()
      .setColor('#5865F2')
      .setTitle('🎮 Name Guesser Lobby Open!')
      .setDescription(`**Host:** <@${game.host}>\n**Prize Pool:** 💰 ${formatNumber(game.prize)}\n**Max Players:** ${game.images.length}\n\nPlayers, click the button below to join!`)
      .addFields({ name: '👥 Players', value: 'None' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ng_join').setLabel('Join').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ng_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('ng_start').setLabel('Start (Host Only)').setStyle(ButtonStyle.Primary)
    );

    const msg = await channel.send({ embeds: [embed], components: [row] });
    game.setupMsgId = msg.id;

    const collector = msg.createMessageComponentCollector({ time: 600000 });
    collector.on('collect', async (i) => {
      if (i.customId === 'ng_join') {
        if (game.players.has(i.user.id)) return i.reply({ content: 'Already in!', flags: [MessageFlags.Ephemeral] });
        if (game.players.size >= game.images.length) return i.reply({ content: 'Lobby full!', flags: [MessageFlags.Ephemeral] });
        game.players.set(i.user.id, { id: i.user.id, name: i.user.username, assignedImageIdx: null, wins: 0, ranked: null });
        i.reply({ content: '✅ Joined!', flags: [MessageFlags.Ephemeral] });
        module.exports.updateLobbyUI(client, game);
      }
      if (i.customId === 'ng_leave') {
        if (!game.players.has(i.user.id)) return i.reply({ content: 'Not in!', flags: [MessageFlags.Ephemeral] });
        game.players.delete(i.user.id);
        i.reply({ content: '👋 Left.', flags: [MessageFlags.Ephemeral] });
        module.exports.updateLobbyUI(client, game);
      }
      if (i.customId === 'ng_start') {
        if (i.user.id !== game.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
        if (game.players.size < 2) return i.reply({ content: 'Need at least 2 players!', flags: [MessageFlags.Ephemeral] });
        collector.stop();
        module.exports.startGame(client, game);
      }
    });
  },

  updateLobbyUI: async (client, game) => {
    const channel = await client.channels.fetch(game.channelId);
    const msg = await channel.messages.fetch(game.setupMsgId).catch(() => null);
    if (!msg) return;

    const playerList = Array.from(game.players.values()).map(p => `• <@${p.id}>`).join('\n') || 'None';
    const embed = new EmbedBuilder(msg.embeds[0].data)
      .setFields({ name: '👥 Players', value: playerList });

    await msg.edit({ embeds: [embed] }).catch(() => {});
  },

  startGame: async (client, game) => {
    game.status = 'RUNNING';
    const channel = await client.channels.fetch(game.channelId);
    channel.send("🎭 **The game is starting! Assigning identities...**");

    // Assignment Logic
    const players = Array.from(game.players.values());
    const availableImages = [...game.images];
    availableImages.sort(() => Math.random() - 0.5);

    for (let i = 0; i < players.length; i++) {
      players[i].assignedImageIdx = game.images.indexOf(availableImages[i]);
      game.images[players[i].assignedImageIdx].assignedTo = players[i].id;
    }

    // Notify Players
    for (const p of players) {
      const user = await client.users.fetch(p.id);
      const otherIdentities = players
        .filter(op => op.id !== p.id)
        .map(op => `• **${op.name}** is: **${game.images[op.assignedImageIdx].name}**`)
        .join('\n');

      const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🎭 Your Secret Identity')
        .setDescription(`You have been assigned an image, but you don't know what it is!\n\n**Others' Identities:**\n${otherIdentities}\n\nGoal: Ask Yes/No questions to figure out who YOU are!`)
        .setFooter({ text: 'Game has started in the server channel.' });

      await user.send({ embeds: [embed] }).catch(() => {});
    }

    module.exports.startTurn(client, game);
  },

  startTurn: async (client, game) => {
    const players = Array.from(game.players.values()).filter(p => p.ranked === null);
    if (players.length === 0) return module.exports.endGame(client, game);

    // Select random player for the turn
    const activePlayer = players[game.turnIdx % players.length];
    game.activePlayerId = activePlayer.id;

    const channel = await client.channels.fetch(game.channelId);
    const embed = new EmbedBuilder()
      .setColor('#F1C40F')
      .setTitle(`🎲 Round: Question for ${activePlayer.name}`)
      .setDescription(`<@${activePlayer.id}>, it is your turn! Ask a **Yes/No question** in chat or in your DMs to figure out your identity.\n\nType your question now...`)
      .addFields({ name: 'Discussion Mode', value: game.discussionMode === 'VC' ? '🎙️ Voice Channel' : '💬 Chat Channel', inline: true })
      .setFooter({ text: 'You can also try to GUESS your identity using the button or "rng guess [name]"' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ng_guess').setLabel('Guess Identity').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ng_toggle_mode').setLabel('Toggle VC/Chat (Host)').setStyle(ButtonStyle.Secondary)
    );

    const turnMsg = await channel.send({ content: `<@${activePlayer.id}>`, embeds: [embed], components: [row] });
    game.currentTurnMsgId = turnMsg.id;

    // Question Collector
    const filter = m => m.author.id === activePlayer.id && !m.content.startsWith(client.prefixes.get(game.guildId) || 'r');
    const collector = channel.createMessageCollector({ filter, max: 1, time: 120000 });

    collector.on('collect', m => {
      module.exports.processQuestion(client, game, m.content);
    });

    collector.on('end', (collected, reason) => {
      if (reason === 'time' && game.status === 'RUNNING' && game.activePlayerId === activePlayer.id) {
        channel.send(`⏰ <@${activePlayer.id}> ran out of time! Skipping to next player.`);
        game.turnIdx++;
        module.exports.startTurn(client, game);
      }
    });
  },

  processQuestion: async (client, game, question) => {
    game.currentQuestion = question;
    const channel = await client.channels.fetch(game.channelId);
    const host = await client.users.fetch(game.host);

    const embed = new EmbedBuilder()
      .setColor('#3498DB')
      .setTitle(`❓ Question: ${question}`)
      .setDescription(`Asked by **${game.players.get(game.activePlayerId).name}**.\n\nOthers, please vote in your DMs!`);

    await channel.send({ embeds: [embed] });

    // Send votes to everyone else
    game.votes.clear();
    const voters = Array.from(game.players.values()).filter(p => p.id !== game.activePlayerId);
    
    const voteRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ng_vote_yes').setLabel('Yes').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('ng_vote_no').setLabel('No').setStyle(ButtonStyle.Danger)
    );

    for (const v of voters) {
      const user = await client.users.fetch(v.id);
      await user.send({ 
        content: `❓ **Question from ${game.players.get(game.activePlayerId).name}:**\n"${question}"`,
        components: [voteRow]
      }).catch(() => {});
    }

    // Host special prompt
    await host.send({
      content: `👑 **Host Decision:**\nQuestion from **${game.players.get(game.activePlayerId).name}**: "${question}"\nYou can override the majority or choose not to answer.`,
      components: [voteRow]
    }).catch(() => {});
    
    // Logic for counting votes is handled by interaction listener
  },

  handleVote: async (client, interaction, game, choice) => {
    if (interaction.user.id === game.activePlayerId) return interaction.reply({ content: "You can't vote on your own question!", flags: [MessageFlags.Ephemeral] });

    if (interaction.user.id === game.host) {
      game.hostDecision = choice;
      interaction.reply({ content: `✅ You decided: **${choice.toUpperCase()}**`, flags: [MessageFlags.Ephemeral] });
    } else {
      game.votes.set(interaction.user.id, choice);
      interaction.reply({ content: `✅ Voted **${choice.toUpperCase()}**`, flags: [MessageFlags.Ephemeral] });
    }

    // Check if everyone voted
    const voterCount = Array.from(game.players.values()).filter(p => p.id !== game.activePlayerId).length;
    if (game.votes.size >= voterCount) {
      module.exports.resolveRound(client, game);
    }
  },

  resolveRound: async (client, game) => {
    const channel = await client.channels.fetch(game.channelId);
    const votes = Array.from(game.votes.values());
    const yes = votes.filter(v => v === 'yes').length;
    const no = votes.filter(v => v === 'no').length;
    const majority = yes >= no ? 'yes' : 'no';

    const finalDecision = game.hostDecision || majority;
    const decisionStr = finalDecision === 'yes' ? '✅ YES' : '❌ NO';

    const embed = new EmbedBuilder()
      .setColor(finalDecision === 'yes' ? '#2ECC71' : '#E74C3C')
      .setTitle(`📢 Round Result: ${decisionStr}`)
      .setDescription(`**Question:** "${game.currentQuestion}"\n**Majority:** ${majority.toUpperCase()} (${yes} Yes, ${no} No)\n**Host Decision:** ${game.hostDecision ? game.hostDecision.toUpperCase() : 'Followed Majority'}`);

    await channel.send({ embeds: [embed] });

    // Notify all players in DMs
    for (const p of game.players.values()) {
      const user = await client.users.fetch(p.id).catch(() => null);
      if (user) await user.send({ embeds: [embed] }).catch(() => {});
    }

    // Clean up
    game.hostDecision = null;
    game.votes.clear();

    if (finalDecision === 'yes') {
      channel.send("🔄 **Correct!** You get to ask another question.");
      module.exports.startTurn(client, game);
    } else {
      channel.send("⏭️ **Incorrect.** Moving to the next player.");
      game.turnIdx++;
      module.exports.startTurn(client, game);
    }
  },

  handleGuess: async (client, interaction, game, guess) => {
    const player = game.players.get(interaction.user.id);
    if (!player) return interaction.reply({ content: "You aren't in this game!", flags: [MessageFlags.Ephemeral] });
    
    const correctName = game.images[player.assignedImageIdx].name;
    const isExact = guess.toLowerCase().trim() === correctName.toLowerCase().trim();

    const host = await client.users.fetch(game.host);
    const channel = await client.channels.fetch(game.channelId);

    if (isExact) {
      module.exports.markWinner(client, game, player);
      interaction.reply({ content: `🎉 **BINGO!** You guessed it right!`, flags: [MessageFlags.Ephemeral] });
    } else {
      // Host Override for typos
      interaction.reply({ content: "📤 Your guess was sent to the Host for validation...", flags: [MessageFlags.Ephemeral] });
      
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ng_validate_win_${player.id}`).setLabel('Valid (Win)').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ng_validate_fail_${player.id}`).setLabel('Invalid (Keep Playing)').setStyle(ButtonStyle.Danger)
      );

      await host.send({
        content: `⚖️ **Guess Validation Required!**\nPlayer: **${player.name}**\nSecret Identity: **${correctName}**\nTheir Guess: **${guess}**\n\nIs this close enough? (e.g. spelling error)`,
        components: [row]
      });
    }
  },

  markWinner: async (client, game, player) => {
    if (player.ranked !== null) return;
    
    player.ranked = game.winners.length + 1;
    game.winners.push(player.id);
    
    const channel = await client.channels.fetch(game.channelId);
    const correctName = game.images[player.assignedImageIdx].name;

    const embed = new EmbedBuilder()
      .setColor('#F1C40F')
      .setTitle(`🏆 WINNER #${player.ranked}: ${player.name}`)
      .setDescription(`They correctly guessed their identity: **${correctName}**!`)
      .setThumbnail(game.images[player.assignedImageIdx].url);

    await channel.send({ embeds: [embed] });

    // Check if game should end
    const remaining = Array.from(game.players.values()).filter(p => p.ranked === null);
    if (remaining.length <= 1) {
      module.exports.endGame(client, game);
    } else {
      // Continue game
      game.turnIdx++;
      module.exports.startTurn(client, game);
    }
  },

  endGame: async (client, game) => {
    const channel = await client.channels.fetch(game.channelId);
    game.status = 'ENDED';

    const netPrize = game.prize;
    const winnerCount = game.winners.length;
    
    if (winnerCount === 0) {
      channel.send("🚫 **Game Ended.** No winners were selected.");
      return client.nameGuesserGames.delete(game.channelId);
    }

    // Split logic: 1st place gets 50%, rest split the other 50%
    const firstWinnerId = game.winners[0];
    let firstPrize = winnerCount === 1 ? netPrize : Math.floor(netPrize * 0.5);
    let restPrize = winnerCount > 1 ? Math.floor((netPrize - firstPrize) / (winnerCount - 1)) : 0;

    const embed = new EmbedBuilder()
      .setColor('#2ECC71')
      .setTitle('🏁 GAME OVER: Final Rankings')
      .setDescription(`**Total Pot:** 💰 ${formatNumber(game.prize)}`)
      .addFields({ 
        name: '🏆 Winners & Payouts', 
        value: game.winners.map((id, idx) => {
          const p = game.players.get(id);
          const payout = idx === 0 ? firstPrize : restPrize;
          return `${idx + 1}. **${p.name}** (+💰 ${formatNumber(payout)})`;
        }).join('\n')
      });

    await channel.send({ embeds: [embed] });

    // Pay winners
    const token = getEconomyToken(client, game.guildId);
    for (let i = 0; i < game.winners.length; i++) {
      const id = game.winners[i];
      const payout = i === 0 ? firstPrize : restPrize;
      if (payout > 0) {
        await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${game.guildId}/users/${id}`, { cash: payout }, {
          headers: { 'Authorization': token }
        }).catch(() => {});
        
        const { enforceMaxBalance } = require('../../../utils/economy.js');
        await enforceMaxBalance(client, game.guildId, id);
      }
    }

    client.nameGuesserGames.delete(game.channelId);
  }
};
