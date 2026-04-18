const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  run: async (client, channel, game) => {
    try {
      await assignRoles(game);
      await notifyRoles(client, game);

      while (game.status !== 'ENDED') {
        // NIGHT PHASE
        await runNightPhase(client, channel, game);
        if (checkWinConditions(channel, game)) break;

        // DAY PHASE
        await runDayPhase(client, channel, game);
        if (checkWinConditions(channel, game)) break;
      }

      await cleanup(client, game);
    } catch (err) {
      console.error('Werewolf Engine Crash:', err);
      channel.send("❌ **The game encountered a critical error and has ended.**");
      client.werewolfGames.delete(game.channelId);
    }
  }
};

async function assignRoles(game) {
  const playerIds = Array.from(game.players.keys());
  const count = playerIds.length;

  // Logic: <7=1, 8-15=2, 15+=3
  let wwCount = game.wwCount || 1;
  if (!game.wwCount) {
    if (count >= 15) wwCount = 3;
    else if (count >= 8) wwCount = 2;
  }

  // Shuffle
  playerIds.sort(() => Math.random() - 0.5);

  for (let i = 0; i < playerIds.length; i++) {
    const p = game.players.get(playerIds[i]);
    if (i < wwCount) p.role = 'WEREWOLF';
    else if (i === wwCount) p.role = 'SEER';
    else p.role = 'VILLAGER';
  }
}

async function notifyRoles(client, game) {
  for (const [id, p] of game.players) {
    try {
      const user = await client.users.fetch(id);
      const embed = new EmbedBuilder()
        .setColor(p.role === 'WEREWOLF' ? '#E74C3C' : '#2ECC71')
        .setTitle(`🐺 You are a ${p.role}!`)
        .setDescription(getRoleDescription(p.role));
      await user.send({ embeds: [embed] });
    } catch (e) {
      console.error(`Could not DM role to ${id}`);
    }
  }
}

function getRoleDescription(role) {
  if (role === 'WEREWOLF') return "Goal: Eliminate the villagers. Work with other werewolves at night to pick a victim.";
  if (role === 'SEER') return "Goal: Expose the werewolves. Each night, you can scan one player to reveal their true identity.";
  return "Goal: Survive and vote out the werewolves during the day.";
}

async function runNightPhase(client, channel, game) {
  game.status = 'NIGHT';
  const nightTime = (game.nightTime || 40) * game.players.size * 1000;
  
  const embed = new EmbedBuilder()
    .setColor('#2C3E50')
    .setTitle('🌙 Night Phase')
    .setDescription(`The sun sets. The village sleeps...\nNight will end in **${nightTime / 1000}s** (or when everyone is ready).`)
    .setFooter({ text: 'Werewolves and Seers, check your DMs!' });
  
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ww_ready').setLabel('Ready (Skip)').setStyle(ButtonStyle.Secondary)
  );

  const nightMsg = await channel.send({ embeds: [embed], components: [row] });
  
  // -- NIGHT ACTIONS (DMs) --
  const wwIds = Array.from(game.players.entries()).filter(([id, p]) => p.alive && p.role === 'WEREWOLF').map(([id]) => id);
  const seerEntry = Array.from(game.players.entries()).find(([id, p]) => p.alive && p.role === 'SEER');
  
  const targets = Array.from(game.players.entries())
    .filter(([id, p]) => p.alive)
    .map(([id, p]) => ({ label: p.name, value: id }));

  // Notify Werewolves
  let votedVictim = null;
  for (const id of wwIds) {
    try {
      const user = await client.users.fetch(id);
      const menu = new StringSelectMenuBuilder()
        .setCustomId('ww_kill')
        .setPlaceholder('Choose a victim...')
        .addOptions(targets.filter(t => !wwIds.includes(t.value)));
      
      const dmRow = new ActionRowBuilder().addComponents(menu);
      const dmMsg = await user.send({ content: '🌑 **Night falls.** Who shall you eliminate tonight?', components: [dmRow] });
      
      const dmColl = dmMsg.createMessageComponentCollector({ time: nightTime });
      dmColl.on('collect', async (i) => {
        votedVictim = i.values[0];
        await i.update({ content: `✅ You have selected **${game.players.get(votedVictim).name}** to be eliminated.`, components: [] });
      });
    } catch (e) {}
  }

  // Notify Seer
  if (seerEntry) {
    try {
      const user = await client.users.fetch(seerEntry[0]);
      const menu = new StringSelectMenuBuilder()
        .setCustomId('ww_scan')
        .setPlaceholder('Pick someone to scan...')
        .addOptions(targets.filter(t => t.value !== seerEntry[0]));
      
      const dmRow = new ActionRowBuilder().addComponents(menu);
      const dmMsg = await user.send({ content: '🔮 **The crystal ball glows.** Whose soul shall you peek into?', components: [dmRow] });
      
      const dmColl = dmMsg.createMessageComponentCollector({ time: nightTime });
      dmColl.on('collect', async (i) => {
        const targetId = i.values[0];
        const role = game.players.get(targetId).role;
        await i.update({ content: `🔮 Your vision reveals that **${game.players.get(targetId).name}** is a **${role}**.`, components: [] });
      });
    } catch (e) {}
  }

  let skipTriggered = false;
  const skipCollector = nightMsg.createMessageComponentCollector({ time: nightTime });
  
  skipCollector.on('collect', (i) => {
    const p = game.players.get(i.user.id);
    if (!p || !p.alive) return i.reply({ content: 'Only living players can ready up.', ephemeral: true });
    p.ready = true;
    
    const readyCount = Array.from(game.players.values()).filter(p => p.alive && p.ready).length;
    const aliveCount = Array.from(game.players.values()).filter(p => p.alive).length;
    
    i.reply({ content: `✅ Ready! (${readyCount}/${aliveCount})`, ephemeral: true });
    if (readyCount >= aliveCount) {
      skipTriggered = true;
      skipCollector.stop();
    }
  });

  await new Promise(r => {
    const t = setTimeout(r, nightTime);
    const check = setInterval(() => { if (skipTriggered) { clearInterval(check); clearTimeout(t); r(); } }, 500);
  });

  game.players.forEach(p => p.ready = false);
  
  if (votedVictim) {
    game.lastVictim = votedVictim;
    game.players.get(votedVictim).alive = false;
  } else {
    game.lastVictim = null;
  }
}

async function runDayPhase(client, channel, game) {
  game.status = 'DAY';
  const dayTime = (game.dayTime || 60) * game.players.size * 1000;

  const summary = game.lastVictim 
    ? `🚫 Bad news: **${game.players.get(game.lastVictim).name}** was found dead this morning.` 
    : '☀️ A quiet night. Everyone survived!';

  const embed = new EmbedBuilder()
    .setColor('#F1C40F')
    .setTitle('☀️ Day Phase: Discussion & Trial')
    .setDescription(`${summary}\n\nDiscuss and vote for who to eliminate!\nTrial ends in: **${dayTime / 1000}s**`)
    .setFooter({ text: 'Everyone must click "Ready" to skip the timer.' });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ww_vote_open').setLabel('Cast Your Vote').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ww_ready').setLabel('Ready (Skip Timer)').setStyle(ButtonStyle.Success)
  );

  const dayMsg = await channel.send({ embeds: [embed], components: [row] });
  
  const votes = new Map(); // voterId -> suspectId
  let skipTriggered = false;

  const collector = dayMsg.createMessageComponentCollector({ time: dayTime });

  collector.on('collect', async (i) => {
    const p = game.players.get(i.user.id);
    if (!p || !p.alive) return i.reply({ content: 'Only living players can participate.', ephemeral: true });

    if (i.customId === 'ww_ready') {
      p.ready = true;
      const readyCount = Array.from(game.players.values()).filter(p => p.alive && p.ready).length;
      const aliveCount = Array.from(game.players.values()).filter(p => p.alive).length;
      
      i.reply({ content: `✅ Marked as ready! (${readyCount}/${aliveCount})`, ephemeral: true });
      if (readyCount >= aliveCount) {
        skipTriggered = true;
        collector.stop();
      }
    }

    if (i.customId === 'ww_vote_open') {
      const options = Array.from(game.players.entries())
        .filter(([id, target]) => target.alive && id !== i.user.id)
        .map(([id, target]) => ({ label: target.name, value: id }));

      if (options.length === 0) return i.reply({ content: 'No one left to vote for!', ephemeral: true });

      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('ww_vote_cast')
        .setPlaceholder('Pick a suspect...')
        .addOptions(options);

      const voteRow = new ActionRowBuilder().addComponents(selectMenu);
      const voteResponse = await i.reply({ content: 'Who do you suspect is the Werewolf?', components: [voteRow], ephemeral: true });
      
      const voteColl = voteResponse.createMessageComponentCollector({ time: 30000 });
      voteColl.on('collect', async (vI) => {
        votes.set(vI.user.id, vI.values[0]);
        await vI.update({ content: `✅ You voted for **${game.players.get(vI.values[0]).name}**.`, components: [] });
      });
    }
  });

  await new Promise(r => {
    const t = setTimeout(r, dayTime);
    const check = setInterval(() => { if (skipTriggered) { clearInterval(check); clearTimeout(t); r(); } }, 500);
  });

  // Tally Votes
  const tally = {};
  votes.forEach((suspectId) => {
    tally[suspectId] = (tally[suspectId] || 0) + 1;
  });

  let eliminatedId = null;
  let maxVotes = 0;
  for (const [id, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count;
      eliminatedId = id;
    }
  }

  if (eliminatedId) {
    const eliminated = game.players.get(eliminatedId);
    eliminated.alive = false;
    channel.send(`⚖️ **The village has decided!** **${eliminated.name}** was eliminated (${maxVotes} votes). They were a **${eliminated.role}**.`);
  } else {
    channel.send("⚖️ **The village couldn't reach a decision.** Nobody was eliminated today.");
  }

  game.players.forEach(p => p.ready = false);
}

function checkWinConditions(channel, game) {
  const alivePlayers = Array.from(game.players.values()).filter(p => p.alive);
  const wws = alivePlayers.filter(p => p.role === 'WEREWOLF').length;
  const vils = alivePlayers.length - wws;

  if (wws === 0) {
    endGame(channel, game, 'Villagers');
    return true;
  }
  if (wws >= vils) {
    endGame(channel, game, 'Werewolves');
    return true;
  }
  return false;
}

async function endGame(channel, game, winners) {
  game.status = 'ENDED';
  const winnerList = Array.from(game.players.values())
    .filter(p => (winners === 'Villagers' ? p.role !== 'WEREWOLF' : p.role === 'WEREWOLF') && p.alive);
  
  const payoutPerPerson = Math.floor(game.prize / (winnerList.length || 1));

  const winEmbed = new EmbedBuilder()
    .setColor('#2ECC71')
    .setTitle(`🎉 ${winners.toUpperCase()} WIN!`)
    .setDescription(`The pot of **💰 ${game.prize}** is split among the survivors:`)
    .addFields({ name: 'Winners', value: winnerList.map(w => `• ${w.name} (+${payoutPerPerson})`).join('\n') || 'None' });

  channel.send({ embeds: [winEmbed] });

  // Payout Logic (Loop through winners)
  for (const w of winnerList) {
    // Find ID
    const entry = Array.from(game.players.entries()).find(([id, p]) => p.name === w.name);
    if (entry) {
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${channel.guild.id}/users/${entry[0]}`, { cash: payoutPerPerson }, {
        headers: { 'Authorization': process.env.UNB_TOKEN }
      }).catch(e => console.error('Payout failed for', entry[0]));
    }
  }
}

async function cleanup(client, game) {
  client.werewolfGames.delete(game.channelId);
}
