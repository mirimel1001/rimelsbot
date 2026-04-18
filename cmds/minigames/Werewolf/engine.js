const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  run: async (client, channel, game) => {
    try {
      await assignRoles(game);
      await notifyRoles(client, game);

      while (game.status !== 'ENDED') {
        await runNightPhase(client, channel, game);
        if (checkWinConditions(channel, game)) break;

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

// --- HELPERS ---
async function safeDM(client, game, userId, content, options = {}) {
  const p = game.players.get(userId);
  try {
    const user = await client.users.fetch(userId);
    const msg = await user.send(Object.assign({ content }, options));
    if (p) p.lastPrompt = { content, options };
    return msg;
  } catch (e) {
    if (p) p.lastPrompt = { content, options };
    const channel = await client.channels.fetch(game.channelId).catch(() => null);
    if (channel) channel.send(`⚠️ <@${userId}>, **I couldn't DM you!** Please enable DMs from server members and type \`rww dm\` to see your prompt.`);
    return null;
  }
}

async function logToHost(client, game, message) {
  try {
    const host = await client.users.fetch(game.host);
    await host.send(`📜 **Game Log:** ${message}`);
  } catch (e) {}
}

async function relayWWChat(client, game, senderId, content) {
  const p = game.players.get(senderId);
  const others = Array.from(game.players.entries()).filter(([id, op]) => op.role === 'WEREWOLF' && op.alive && id !== senderId);
  await logToHost(client, game, `💬 **WW Chat** from **${p.name}**: ${content}`);
  for (const [id] of others) {
    try {
      const user = await client.users.fetch(id);
      await user.send(`🐺 **${p.name}:** ${content}`);
    } catch (e) {}
  }
}

function generateNightEmbed(game, ready = 0, total = 0) {
  const nightTime = (game.nightTime || 40) * game.players.size;
  const alive = Array.from(game.players.values()).filter(p => p.alive).map(p => `• ${p.name}`).join('\n') || 'None';
  const dead = Array.from(game.players.values()).filter(p => !p.alive).map(p => `• ~~${p.name}~~`).join('\n') || 'None';

  return new EmbedBuilder()
    .setColor('#2C3E50')
    .setTitle('🌙 Night Phase')
    .setDescription(`The sun sets. The village sleeps...\nNight ends in **${nightTime}s**.\n\n> 🤫 **Social Rule:** Please stay silent in this channel until morning!\n\n**Ready:** ${ready}/${total}`)
    .addFields(
      { name: '👥 Alive', value: alive, inline: true },
      { name: '💀 Dead', value: dead, inline: true }
    )
    .setFooter({ text: 'Check DMs for actions! • Manual: rww kill [name], rww skip' });
}

function generateDayEmbed(game, summary, ready = 0, total = 0) {
  const dayTime = (game.dayTime || 60) * game.players.size;
  const alive = Array.from(game.players.values()).filter(p => p.alive).map(p => `• ${p.name}`).join('\n') || 'None';
  const dead = Array.from(game.players.values()).filter(p => !p.alive).map(p => `• ~~${p.name}~~`).join('\n') || 'None';

  return new EmbedBuilder()
    .setColor('#F1C40F')
    .setTitle('☀️ Day Phase: Discussion')
    .setDescription(`${summary}\n\nDiscuss & Vote! Ends in: **${dayTime}s**\nUse \`rww v [name]\` or the button to vote.\n\n**Ready:** ${ready}/${total}`)
    .addFields(
      { name: '👥 Alive', value: alive, inline: true },
      { name: '💀 Dead', value: dead, inline: true }
    )
    .setFooter({ text: 'Manual: rww vote [name], rww skip' });
}

async function assignRoles(game) {
  const playerIds = Array.from(game.players.keys());
  playerIds.sort(() => Math.random() - 0.5);
  const count = playerIds.length;
  let wwCount = game.wwCount || (count >= 15 ? 3 : (count >= 8 ? 2 : 1));
  for (let i = 0; i < playerIds.length; i++) {
    const p = game.players.get(playerIds[i]);
    if (i < wwCount) p.role = 'WEREWOLF';
    else if (i === wwCount) {
      p.role = 'SEER';
      p.scans = game.seerLimit; // Initialize scans
    } else p.role = 'VILLAGER';
  }
}

async function notifyRoles(client, game) {
  await logToHost(client, game, "🌑 **Game Started!** Dispatching roles...");
  for (const [id, p] of game.players) {
    const embed = new EmbedBuilder().setColor(p.role === 'WEREWOLF' ? '#E74C3C' : '#2ECC71')
      .setTitle(`🐺 You are a ${p.role}!`).setDescription(getRoleDescription(p.role));
    await safeDM(client, game, id, "", { embeds: [embed] });
    await logToHost(client, game, `• <@${id}> is a **${p.role}**`);
  }
}

function getRoleDescription(role) {
  if (role === 'WEREWOLF') return "Goal: Eliminate the villagers. Work with your pack in DMs during the night to pick a victim!";
  if (role === 'SEER') return "Goal: Expose the werewolves. Each night, you can scan one player to reveal their true identity.";
  return "Goal: Survive and vote out the werewolves during the day.";
}

async function runNightPhase(client, channel, game) {
  game.status = 'NIGHT';
  const nightTime = (game.nightTime || 40) * game.players.size * 1000;
  const alivePlayers = Array.from(game.players.values()).filter(p => p.alive);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ww_ready').setLabel('Ready (Skip)').setStyle(ButtonStyle.Secondary));
  const nightMsg = await channel.send({ embeds: [generateNightEmbed(game, 0, alivePlayers.length)], components: [row] });
  
  const wwIds = Array.from(game.players.entries()).filter(([id, p]) => p.alive && p.role === 'WEREWOLF').map(([id]) => id);
  const seerId = Array.from(game.players.entries()).find(([id, p]) => p.role === 'SEER' && p.alive)?.[0];
  const targets = Array.from(game.players.entries()).filter(([id, p]) => p.alive);

  for (const id of wwIds) {
    const options = targets.filter(([tId]) => !wwIds.includes(tId)).map(([tId, tp]) => ({ label: tp.name, value: tId }));
    const menu = new StringSelectMenuBuilder().setCustomId('ww_kill').setPlaceholder('Choose a victim...').addOptions(options);
    await safeDM(client, game, id, '🌑 **Night falls.** Use the menu or type `rww k [name]` to select a victim.', { components: [new ActionRowBuilder().addComponents(menu)] });
  }

  if (seerId) {
    const sp = game.players.get(seerId);
    if (game.seerLimit === undefined || sp.scans > 0) {
      const options = targets.filter(([tId]) => tId !== seerId).map(([tId, tp]) => ({ label: tp.name, value: tId }));
      const menu = new StringSelectMenuBuilder().setCustomId('ww_scan').setPlaceholder('Choose a target...').addOptions(options);
      await safeDM(client, game, seerId, `🔮 **The crystal ball glows.** Use the menu or type \`rww sc [name]\` to scan a player.\n*Remaining scans: ${sp.scans !== undefined ? sp.scans : '∞'}*`, { components: [new ActionRowBuilder().addComponents(menu)] });
    } else {
      await safeDM(client, game, seerId, "🔮 **The crystal ball is dim.** You have no scans remaining.");
    }
  }

  const startTime = Date.now();
  let victim = null; game.nightVote = new Map();
  let lastReadyCount = 0;

  while (Date.now() - startTime < nightTime) {
    const alive = Array.from(game.players.values()).filter(p => p.alive);
    const readyCount = alive.filter(p => p.ready).length;
    if (readyCount !== lastReadyCount) {
      lastReadyCount = readyCount;
      await nightMsg.edit({ embeds: [generateNightEmbed(game, readyCount, alive.length)] }).catch(() => null);
    }
    if (alive.every(p => p.ready)) break;
    const wwVotes = Array.from(game.nightVote.entries());
    if (wwVotes.length > 0) {
      const lastEntry = wwVotes[wwVotes.length - 1];
      if (lastEntry[1] !== victim) {
        victim = lastEntry[1];
        await logToHost(client, game, `🐺 **${game.players.get(lastEntry[0]).name}** selected to kill **${game.players.get(victim).name}**`);
      }
    }
    await new Promise(r => setTimeout(r, 1000));
  }

  if (victim) {
    game.lastVictim = victim;
    game.players.get(victim).alive = false;
    await logToHost(client, game, `🔪 Werewolves eliminated **${game.players.get(victim).name}**`);
  } else {
    game.lastVictim = null;
    await logToHost(client, game, `🌙 No one was eliminated tonight.`);
  }
  game.players.forEach(p => p.ready = false);
  game.nightVote = null;
  nightMsg.edit({ components: [] }).catch(() => null);
}

async function runDayPhase(client, channel, game) {
  game.status = 'DAY';
  const dayTime = (game.dayTime || 60) * game.players.size * 1000;
  const summary = game.lastVictim ? `🚫 **${game.players.get(game.lastVictim).name}** was found dead this morning.` : '☀️ A quiet night. Everyone survived!';
  const alivePlayers = Array.from(game.players.values()).filter(p => p.alive);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ww_vote_open').setLabel('Cast Your Vote').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ww_ready').setLabel('Ready (Skip Timer)').setStyle(ButtonStyle.Success)
  );
  const dayMsg = await channel.send({ embeds: [generateDayEmbed(game, summary, 0, alivePlayers.length)], components: [row] });
  game.dayVotes = new Map();
  const startTime = Date.now();
  let lastReadyCount = 0;

  while (Date.now() - startTime < dayTime) {
    const alive = Array.from(game.players.values()).filter(p => p.alive);
    const readyCount = alive.filter(p => p.ready).length;
    if (readyCount !== lastReadyCount) {
      lastReadyCount = readyCount;
      await dayMsg.edit({ embeds: [generateDayEmbed(game, summary, readyCount, alive.length)] }).catch(() => null);
    }
    if (alive.every(p => p.ready)) break;
    await new Promise(r => setTimeout(r, 1000));
  }

  // Log breakdown to Host
  if (game.dayVotes.size > 0) {
    let breakdown = "🗳️ **Daily Vote Breakdown:**\n";
    game.dayVotes.forEach((targetId, voterId) => {
      breakdown += `• **${game.players.get(voterId).name}** voted for **${game.players.get(targetId).name}**\n`;
    });
    await logToHost(client, game, breakdown);
  }

  const counts = {}; game.dayVotes.forEach(targetId => counts[targetId] = (counts[targetId] || 0) + 1);
  let eliminatedId = Object.keys(counts).sort((a,b) => counts[b] - counts[a])[0];
  if (eliminatedId && counts[eliminatedId] > 0) {
    const eliminated = game.players.get(eliminatedId);
    eliminated.alive = false;
    channel.send(`⚖️ **${eliminated.name}** was eliminated. They were a **${eliminated.role}**.`);
    await logToHost(client, game, `⚖️ Village eliminated **${eliminated.name}** (${eliminated.role})`);
  } else {
    channel.send("⚖️ No decision reached.");
  }
  game.players.forEach(p => p.ready = false);
  game.dayVotes = null;
  dayMsg.edit({ components: [] }).catch(() => null);
}

function checkWinConditions(channel, game) {
  const alive = Array.from(game.players.values()).filter(p => p.alive);
  const wws = alive.filter(p => p.role === 'WEREWOLF').length;
  const vils = alive.length - wws;
  if (wws === 0) return endGame(channel, game, 'Villagers');
  if (wws >= vils) return endGame(channel, game, 'Werewolves');
  return false;
}

async function endGame(channel, game, winners) {
  game.status = 'ENDED';
  const winnerList = Array.from(game.players.values()).filter(p => (winners === 'Villagers' ? p.role !== 'WEREWOLF' : p.role === 'WEREWOLF') && p.alive);
  const payout = Math.floor(game.prize / (winnerList.length || 1));
  const winEmbed = new EmbedBuilder().setColor('#2ECC71').setTitle(`🎉 ${winners.toUpperCase()} WIN!`).addFields({ name: 'Winners', value: winnerList.map(w => `• ${w.name} (+${payout})`).join('\n') || 'None' });
  channel.send({ embeds: [winEmbed] });
  for (const w of winnerList) {
    const entry = Array.from(game.players.entries()).find(([id, p]) => p.name === w.name);
    if (entry) await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${channel.guild.id}/users/${entry[0]}`, { cash: payout }, { headers: { 'Authorization': process.env.UNB_TOKEN } }).catch(() => null);
  }
  return true;
}

async function cleanup(client, game) { client.werewolfGames.delete(game.channelId); }
module.exports.relayChat = relayWWChat; module.exports.safeDM = safeDM; module.exports.logToHost = logToHost;
