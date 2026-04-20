const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const axios = require('axios');

module.exports = {
  run: async (client, channel, game) => {
    try {
      game.logs = [];
      game.startTime = new Date();
      game.hostLogMsgId = null;
      await assignRoles(game);
      await notifyRoles(client, game);
      game.nightCount = 0;

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
  if (!game.logs) game.logs = [];
  
  const phasePrefix = game.status === 'NIGHT' ? `[N${game.nightCount}] ` : 
                     game.status === 'DAY' ? `[D${game.nightCount}] ` : 
                     '[Game] ';
  
  game.logs.push(phasePrefix + message);
  if (game.logs.length > 50) game.logs.shift(); // Keep readable length

  const timeStr = game.startTime ? game.startTime.toLocaleString() : new Date().toLocaleString();
  const logEmbed = new EmbedBuilder()
    .setColor('#3498DB')
    .setTitle(`📜 A Game of Werewolf - ${timeStr}`)
    .setDescription(game.logs.join('\n'));

  try {
    const host = await client.users.fetch(game.host);
    
    // Delete old message if it exists
    if (game.hostLogMsgId) {
      const dmChannel = host.dmChannel || await host.createDM();
      const oldMsg = await dmChannel.messages.fetch(game.hostLogMsgId).catch(() => null);
      if (oldMsg) await oldMsg.delete().catch(() => null);
    }

    const newMsg = await host.send({ embeds: [logEmbed] });
    game.hostLogMsgId = newMsg.id;
  } catch (e) {}
}

async function relayWWChat(client, game, senderId, content) {
  const p = game.players.get(senderId);
  if (!game.packChatHistory) game.packChatHistory = [];
  if (!game.packChatMsgIds) game.packChatMsgIds = new Map();

  game.packChatHistory.push(`[Werewolf] **${p.name}** says: ${content}`);
  if (game.packChatHistory.length > 25) game.packChatHistory.shift(); // Keep readable

  const chatEmbed = new EmbedBuilder()
    .setColor('#E74C3C')
    .setTitle(`🐺 Werewolf Pack Chat (Night ${game.nightCount})`)
    .setDescription(game.packChatHistory.join('\n'))
    .setFooter({ text: 'Type "wsay [text]" to chat with your pack.' });

  const recipients = Array.from(game.players.entries())
    .filter(([id, op]) => op.role === 'WEREWOLF' && op.alive)
    .map(([id]) => id);
  if (!recipients.includes(game.host)) recipients.push(game.host);

  for (const id of recipients) {
    try {
      const user = await client.users.fetch(id);
      
      // Delete old message if it exists
      if (game.packChatMsgIds.has(id)) {
        const oldMsgId = game.packChatMsgIds.get(id);
        const dmChannel = user.dmChannel || await user.createDM();
        const oldMsg = await dmChannel.messages.fetch(oldMsgId).catch(() => null);
        if (oldMsg) await oldMsg.delete().catch(() => null);
      }

      const newMsg = await user.send({ embeds: [chatEmbed] });
      game.packChatMsgIds.set(id, newMsg.id);
    } catch (e) {}
  }
}

function getAliveIndexed(game) {
  // Sort by name for consistent indexing during the phase
  return Array.from(game.players.entries())
    .filter(([id, p]) => p.alive)
    .sort((a, b) => a[1].name.localeCompare(b[1].name));
}

function generateNightEmbed(game, ready = 0, total = 0, remainingTime = 0) {
  const indexed = getAliveIndexed(game);
  const aliveList = indexed
    .map(([id, p], idx) => `${idx + 1}. **${p.name}**${p.ready ? ' ✅' : ''}`)
    .join('\n') || 'None';
  const deadList = Array.from(game.players.values())
    .filter(p => !p.alive)
    .map(p => `• ~~${p.name}~~`)
    .join('\n') || 'None';

  return new EmbedBuilder()
    .setColor('#2C3E50')
    .setTitle(`🌙 Night Phase ${game.nightCount}`)
    .setDescription(`The sun sets. The village sleeps...\nNight ends in **${remainingTime}s**.\n\n**Ready:** ${ready}/${total}`)
    .addFields(
      { name: '👥 Alive', value: aliveList, inline: true },
      { name: '💀 Dead', value: deadList, inline: true },
      { name: '📜 Available Commands', value: 
        "**Players:** `rww status`, `rww skip`, `rww dm`\n" +
        "**Werewolves:** `rww kill [name/id]`, `rww wsay [text]`\n" +
        "**Seer:** `rww scan [name/id]`\n" +
        "**Host:** `rww cancel`"
      }
    )
    .setFooter({ text: 'Buttons below | Manual: rww kill [name], rww skip, rww status' });
}

function generateDayEmbed(game, summary, ready = 0, total = 0, remainingTime = 0) {
  const counts = {};
  if (game.dayVotes) {
    game.dayVotes.forEach(targetId => counts[targetId] = (counts[targetId] || 0) + 1);
  }

  const indexed = getAliveIndexed(game);
  const aliveList = indexed
    .map(([id, p], idx) => `${idx + 1}. **${p.name}**${counts[id] ? ` (**${counts[id]} votes**)` : ''}${p.ready ? ' ✅' : ''}`)
    .join('\n') || 'None';
  const deadList = Array.from(game.players.values())
    .filter(p => !p.alive)
    .map(p => `• ~~${p.name}~~`)
    .join('\n') || 'None';

  return new EmbedBuilder()
    .setColor('#F1C40F')
    .setTitle(`☀️ Day Phase ${game.nightCount}: Discussion`)
    .setDescription(`${summary}\n\nDiscuss & Vote! Ends in: **${remainingTime}s**\n\n**Ready:** ${ready}/${total}`)
    .addFields(
      { name: '👥 Alive', value: aliveList, inline: true },
      { name: '💀 Dead', value: deadList, inline: true },
      { name: '📜 Available Commands', value: 
        "**Players:** `rww vote [name/id]`, `rww skip`, `rww status`, `rww dm`\n" +
        "**Host:** `rww cancel`"
      }
    )
    .setFooter({ text: 'Buttons below | Manual: rww vote [name], rww skip, rww status' });
}

async function assignRoles(game) {
  const playerIds = Array.from(game.players.keys());
  playerIds.sort(() => Math.random() - 0.5);
  const count = playerIds.length;
  let wwCount = game.wwCount || (count >= 15 ? 3 : (count >= 8 ? 2 : 1));
  for (let i = 0; i < playerIds.length; i++) {
    const p = game.players.get(playerIds[i]);
    p.id = playerIds[i]; // Ensure ID is stored
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
    const roleEmojis = { 'WEREWOLF': '🐺', 'SEER': '🔮', 'VILLAGER': '👨‍🌾' };
    let description = getRoleDescription(p.role);
    
    if (p.role === 'WEREWOLF') {
      const pack = Array.from(game.players.values()).filter(tp => tp.role === 'WEREWOLF').map(tp => `• **${tp.name}**`).join('\n');
      description += `\n\n**🐺 Your Pack:**\n${pack}`;
    }

    const embed = new EmbedBuilder().setColor(p.role === 'WEREWOLF' ? '#E74C3C' : '#2ECC71')
      .setTitle(`${roleEmojis[p.role] || '👤'} You are a ${p.role}!`)
      .setDescription(description);
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
  game.nightCount++;
  game.packChatHistory = [];
  game.packChatMsgIds = new Map();
  
  const totalNightTime = (game.nightTime || 40) * game.players.size;
  game.players.forEach(p => { p.ready = false; p.scannedThisNight = false; });
  const alivePlayers = Array.from(game.players.values()).filter(p => p.alive);
  const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('ww_ready').setLabel('Ready (Skip)').setStyle(ButtonStyle.Secondary));
  const nightMsg = await channel.send({ embeds: [generateNightEmbed(game, 0, alivePlayers.length, totalNightTime)], components: [row] });
  
  // Broadcast phase embed to all participants + Host
  const nightEmbed = generateNightEmbed(game, 0, alivePlayers.length, totalNightTime);
  for (const [id] of game.players) {
    await safeDM(client, game, id, `🌙 **Night ${game.nightCount} Started**`, { embeds: [nightEmbed] });
  }
  if (!game.players.has(game.host)) {
    await safeDM(client, game, game.host, `🌙 **Night ${game.nightCount} Started**`, { embeds: [nightEmbed] });
  }
  
  game.nightVote = new Map();
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
    if (game.seerLimit === null || sp.scans > 0) {
      const options = targets.filter(([tId]) => tId !== seerId).map(([tId, tp]) => ({ label: tp.name, value: tId }));
      const menu = new StringSelectMenuBuilder().setCustomId('ww_scan').setPlaceholder('Choose a target...').addOptions(options);
      await safeDM(client, game, seerId, `🔮 **The crystal ball glows.** Use the menu or type \`rww sc [name]\` to scan a player.\n*Remaining scans: ${sp.scans !== undefined ? sp.scans : '∞'}*`, { components: [new ActionRowBuilder().addComponents(menu)] });
    } else {
      await safeDM(client, game, seerId, "🔮 **The crystal ball is dim.** You have no scans remaining.");
    }
  }

  const startTime = Date.now();
  const nightDurationMs = (game.nightTime || 40) * game.players.size * 1000;
  let victim = null;
  let lastReadyCount = 0;
  let lastUpdate = Date.now();

  while (Date.now() - startTime < nightDurationMs) {
    const alive = Array.from(game.players.values()).filter(p => p.alive);
    const readyCount = alive.filter(p => p.ready).length;
    const remaining = Math.max(0, Math.floor((nightDurationMs - (Date.now() - startTime)) / 1000));

    if (readyCount !== lastReadyCount || Date.now() - lastUpdate >= 5000) {
      lastReadyCount = readyCount;
      lastUpdate = Date.now();
      await nightMsg.edit({ embeds: [generateNightEmbed(game, readyCount, alive.length, remaining)] }).catch(() => null);
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
  const summary = game.lastVictim ? `🚫 **${game.players.get(game.lastVictim).name}** was found dead this morning.` : '☀️ A quiet night. Everyone survived!';
  const totalDayTime = (game.dayTime || 60) * game.players.size;
  const alivePlayers = Array.from(game.players.values()).filter(p => p.alive);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ww_vote_open').setLabel('Cast Your Vote').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ww_vote_cancel').setLabel('Cancel Vote').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('ww_ready').setLabel('Ready (Skip Timer)').setStyle(ButtonStyle.Success)
  );
  const dayMsg = await channel.send({ embeds: [generateDayEmbed(game, summary, 0, alivePlayers.length, totalDayTime)], components: [row] });
  
  // Broadcast phase embed to all participants + Host
  const dayEmbed = generateDayEmbed(game, summary, 0, alivePlayers.length, totalDayTime);
  for (const [id] of game.players) {
    await safeDM(client, game, id, `☀️ **Day ${game.nightCount} Started**`, { embeds: [dayEmbed] });
  }
  if (!game.players.has(game.host)) {
    await safeDM(client, game, game.host, `☀️ **Day ${game.nightCount} Started**`, { embeds: [dayEmbed] });
  }
  game.dayVotes = new Map();
  const startTime = Date.now();
  const dayDurationMs = (game.dayTime || 60) * game.players.size * 1000;
  let lastReadyCount = 0;
  let lastUpdate = Date.now();

  while (Date.now() - startTime < dayDurationMs) {
    const alive = Array.from(game.players.values()).filter(p => p.alive);
    const readyCount = alive.filter(p => p.ready).length;
    const remaining = Math.max(0, Math.floor((dayDurationMs - (Date.now() - startTime)) / 1000));

    if (readyCount !== lastReadyCount || Date.now() - lastUpdate >= 5000) {
      lastReadyCount = readyCount;
      lastUpdate = Date.now();
      const updatedEmbed = generateDayEmbed(game, summary, readyCount, alive.length, remaining);
      await dayMsg.edit({ embeds: [updatedEmbed] }).catch(() => null);
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
  
  const netPrize = Math.floor(game.prize * 0.8);
  const payout = Math.floor(netPrize / (winnerList.length || 1));
  
  const winEmbed = new EmbedBuilder().setColor('#2ECC71')
    .setTitle(`🎉 ${winners.toUpperCase()} WIN!`)
    .setDescription(`**Total prize pool from Host:** 💰 ${game.prize}\n**Net prize after 20% cut:** 💰 ${netPrize}`)
    .addFields({ name: 'Winners', value: winnerList.map(w => `• ${w.name} (+${payout})`).join('\n') || 'None' });
  channel.send({ embeds: [winEmbed] });
  for (const w of winnerList) {
    const entry = Array.from(game.players.entries()).find(([id, p]) => p.name === w.name);
    if (entry) await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${game.guildId}/users/${entry[0]}`, { cash: payout }, { headers: { 'Authorization': process.env.UNB_TOKEN } }).catch(() => null);
  }
  return true;
}

async function cleanup(client, game) { client.werewolfGames.delete(game.channelId); }
module.exports.relayChat = relayWWChat; module.exports.safeDM = safeDM; module.exports.logToHost = logToHost;
