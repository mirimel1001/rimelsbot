const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

module.exports = {
  name: "werewolf",
  aliases: ["ww", "warewolf"],
  description: "Multiplayer Werewolf Game Logic.",
  usage: "werewolf [setup/status/join/leave/start/cancel/launch/setprize/setplayers/setseer/setnight/setday]",
  run: async (client, message, args, prefix, config) => {
    const subCommand = args[0]?.toLowerCase();
    const game = client.werewolfGames.get(message.channel.id);

    // --- 1. SETUP COMMAND ---
    if (subCommand === 'setup') {
      if (game) return message.reply("⚠️ A Werewolf session is already active in this channel.");
      
      const newGame = {
        host: message.author.id,
        hostName: message.author.username,
        channelId: message.channel.id,
        status: 'SETUP',
        prize: 0,
        maxPlayers: 10,
        seerMode: 'SIMPLE',
        nightTime: 40,
        dayTime: 60,
        players: new Map(),
        setupMsgId: null
      };

      client.werewolfGames.set(message.channel.id, newGame);
      return startInteractiveSetup(client, message, newGame);
    }

    if (subCommand === 'status' && game) {
      if (game.status === 'SETUP') {
        return startInteractiveSetup(client, message, game); // Resend/Update dashboard
      }
      return message.reply(`🎮 **Game in Progress:** ${game.status}\n👥 **Players:** ${game.players.size}/${game.maxPlayers}\n💰 **Prize:** ${game.prize}`);
    }

    // --- 2. CONFIG COMMANDS (MANUAL) ---
    if (game && game.status === 'SETUP') {
      if (message.author.id !== game.host) return;

      if (subCommand === 'setprize') {
        const val = parseInt(args[1]);
        if (isNaN(val)) return message.reply("❌ Usage: `rww setprize [amount]`");
        game.prize = val;
        message.reply(`✅ Prize set to **${val}**.`);
        return refreshSetupUI(client, message, game);
      }
      if (subCommand === 'setplayers') {
        const val = parseInt(args[1]);
        if (isNaN(val) || val < 4) return message.reply("❌ Usage: `rww setplayers [4-20]`");
        game.maxPlayers = val;
        message.reply(`✅ Max players set to **${val}**.`);
        return refreshSetupUI(client, message, game);
      }
      if (subCommand === 'setseer') {
        game.seerMode = args[1]?.toUpperCase() === 'EXACT' ? 'EXACT' : 'SIMPLE';
        message.reply(`✅ Seer mode set to **${game.seerMode}**.`);
        return refreshSetupUI(client, message, game);
      }
      if (subCommand === 'setnight') {
        const val = parseInt(args[1]);
        if (isNaN(val)) return message.reply("❌ Usage: `rww setnight [seconds per player]`");
        game.nightTime = val;
        message.reply(`✅ Night timer set to **${val}s/p**.`);
        return refreshSetupUI(client, message, game);
      }
      if (subCommand === 'setday') {
        const val = parseInt(args[1]);
        if (isNaN(val)) return message.reply("❌ Usage: `rww setday [seconds per player]`");
        game.dayTime = val;
        message.reply(`✅ Day timer set to **${val}s/p**.`);
        return refreshSetupUI(client, message, game);
      }
      if (subCommand === 'launch') {
        if (game.prize <= 0) return message.reply("❌ Set prize pool first!");
        return launchLobby(client, message, game);
      }
      if (subCommand === 'cancel' || subCommand === 'exit') {
        client.werewolfGames.delete(message.channel.id);
        return message.reply("⭕ Setup cancelled and closed.");
      }
    }

    // --- 3. LOBBY COMMANDS ---
    // --- 4. GAME ACTIONS (MANUAL COMMANDS) ---
    if (game && (game.status === 'NIGHT' || game.status === 'DAY')) {
      const p = game.players.get(message.author.id);
      if (!p || !p.alive) return;

      // SKIP / READY
      if (subCommand === 'skip' || subCommand === 's' || subCommand === 'ready') {
        p.ready = true;
        return message.reply("✅ Status: **Ready**.");
      }

      // VOTE (Day)
      if (game.status === 'DAY' && (subCommand === 'vote' || subCommand === 'v')) {
        const targetName = args.slice(1).join(' ').toLowerCase();
        const targetEntry = Array.from(game.players.entries()).find(([id, tp]) => tp.alive && tp.name.toLowerCase().includes(targetName) && id !== message.author.id);
        if (!targetEntry) return message.reply("❌ Player not found or invalid target.");
        game.dayVotes.set(message.author.id, targetEntry[0]);
        return message.reply(`✅ Voted for **${targetEntry[1].name}**.`);
      }

      // KILL (Night - Werewolf)
      if (game.status === 'NIGHT' && (subCommand === 'kill' || subCommand === 'k')) {
        if (p.role !== 'WEREWOLF') return;
        const targetName = args.slice(1).join(' ').toLowerCase();
        const targetEntry = Array.from(game.players.entries()).find(([id, tp]) => tp.alive && tp.name.toLowerCase().includes(targetName) && tp.role !== 'WEREWOLF');
        if (!targetEntry) return message.reply("❌ Invalid target.");
        game.nightVote.set(message.author.id, targetEntry[0]);
        return message.reply(`✅ Selection: **${targetEntry[1].name}**.`);
      }

      // SCAN (Night - Seer)
      if (game.status === 'NIGHT' && (subCommand === 'scan' || subCommand === 'sc')) {
        if (p.role !== 'SEER') return;
        const targetName = args.slice(1).join(' ').toLowerCase();
        const targetEntry = Array.from(game.players.entries()).find(([id, tp]) => tp.alive && tp.name.toLowerCase().includes(targetName) && id !== message.author.id);
        if (!targetEntry) return message.reply("❌ Invalid target.");
        let result = targetEntry[1].role;
        if (game.seerMode === 'SIMPLE') result = targetEntry[1].role === 'WEREWOLF' ? 'WEREWOLF' : 'NOT a Werewolf';
        return message.reply(`🔮 Your vision reveals: **${targetEntry[1].name}** is a **${result}**.`);
      }

      // DM RECOVERY
      if (subCommand === 'dm') {
        const engine = require('./engine.js');
        if (!p.lastPrompt) return message.reply("❌ No active prompt found for you.");
        await engine.safeDM(client, game, message.author.id, p.lastPrompt.content, p.lastPrompt.options);
        return message.reply("📥 Sent your prompt again. Check DMs!");
      }
    }

    if (!game && !subCommand) return message.reply(`🐺 Use \`${prefix}ww setup\` to start an event!`);
  }
};

async function launchLobby(client, message, game) {
  try {
    const ub = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${game.host}`, {
      headers: { 'Authorization': process.env.UNB_TOKEN }
    });
    if (ub.data.cash < game.prize) return message.reply("❌ Insufficient funds.");
    await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${game.host}`, { cash: -game.prize }, {
      headers: { 'Authorization': process.env.UNB_TOKEN }
    });
  } catch (e) { return message.reply("❌ UNB Error."); }

  game.status = 'LOBBY';
  await sendLobbyUI(message.channel, game);
}

async function sendLobbyUI(channel, game) {
  const embed = new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🐺 Werewolf Lobby Open!')
    .setDescription(`**Host:** <@${game.host}>\n**Prize Pool:** 💰 ${game.prize}\n**Seer Mode:** ${game.seerMode}\n**Players:** ${game.players.size}/${game.maxPlayers}`);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ww_join').setLabel('Join').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ww_leave').setLabel('Leave').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ww_start').setLabel('Start (Host)').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('ww_cancel').setLabel('Cancel').setStyle(ButtonStyle.Secondary)
  );

  const msg = await channel.send({ embeds: [embed], components: [row] });
  const client = channel.client;
  const collector = msg.createMessageComponentCollector({ time: 3600000 });

  collector.on('collect', async (i) => {
    const g = client.werewolfGames.get(i.channelId);
    if (!g || g.status !== 'LOBBY') return;

    if (i.customId === 'ww_join') {
      if (g.players.has(i.user.id)) return i.reply({ content: 'Already in!', ephemeral: true });
      if (g.players.size >= g.maxPlayers) return i.reply({ content: 'Full!', ephemeral: true });
      g.players.set(i.user.id, { name: i.user.username, role: null, alive: true, ready: false });
      i.reply({ content: '✅ Joined!', ephemeral: true });
      updateLobbyUI(msg, g);
    }
    if (i.customId === 'ww_leave') {
      g.players.delete(i.user.id);
      i.reply({ content: '👋 Left.', ephemeral: true });
      updateLobbyUI(msg, g);
    }
    if (i.customId === 'ww_start') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', ephemeral: true });
      if (g.players.size < 4) return i.reply({ content: 'Need 4 players!', ephemeral: true });
      collector.stop();
      startGame(client, i.channel, g);
    }
    if (i.customId === 'ww_cancel') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', ephemeral: true });
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${i.guildId}/users/${g.host}`, { cash: g.prize }, {
        headers: { 'Authorization': process.env.UNB_TOKEN }
      });
      client.werewolfGames.delete(i.channelId);
      collector.stop();
      i.update({ content: '⭕ Cancelled.', embeds: [], components: [] });
    }
  });

  // Handle Global Interactions for Game Phases
  client.on('interactionCreate', async (i) => {
    if (!i.isButton() && !i.isStringSelectMenu()) return;
    const g = Array.from(client.werewolfGames.values()).find(game => game.players.has(i.user.id));
    if (!g) return;

    const p = g.players.get(i.user.id);
    if (!p || !p.alive) return;

    if (i.customId === 'ww_ready') {
      p.ready = true;
      i.reply({ content: '✅ Ready!', ephemeral: true });
    }
    if (i.customId === 'ww_vote_cast') {
      g.dayVotes.set(i.user.id, i.values[0]);
      i.update({ content: `✅ Voted for **${g.players.get(i.values[0]).name}**`, components: [] });
    }
    if (i.customId === 'ww_kill') {
      g.nightVote.set(i.user.id, i.values[0]);
      i.update({ content: `✅ Selected **${g.players.get(i.values[0]).name}**`, components: [] });
    }
    if (i.customId === 'ww_scan') {
      const target = g.players.get(i.values[0]);
      let res = target.role;
      if (g.seerMode === 'SIMPLE') res = target.role === 'WEREWOLF' ? 'WEREWOLF' : 'NOT a Werewolf';
      i.update({ content: `🔮 Vision: **${target.name}** is a **${res}**`, components: [] });
    }
  });
}

function updateLobbyUI(msg, game) {
  const embed = new EmbedBuilder(msg.embeds[0].data)
    .setDescription(`**Host:** <@${game.host}>\n**Prize Pool:** 💰 ${game.prize}\n**Seer Mode:** ${game.seerMode}\n**Players:** ${game.players.size}/${game.maxPlayers}`);
  msg.edit({ embeds: [embed] }).catch(() => {});
}

function startGame(client, channel, game) {
  const engine = require('./engine.js');
  game.status = 'STARTING';
  channel.send("🌑 **The game is starting! Check your DMs...**");
  engine.run(client, channel, game);
}

async function refreshSetupUI(client, message, game) {
  if (!game.setupMsgId) return;
  try {
    const channel = await client.channels.fetch(game.channelId);
    const msg = await channel.messages.fetch(game.setupMsgId);
    const embed = generateSetupEmbed(game);
    await msg.edit({ embeds: [embed] });
  } catch (e) {}
}

function generateSetupEmbed(game) {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🌑 Werewolf Setup: Configuration')
    .setDescription('Use the buttons below to tune your game settings.')
    .addFields(
      { name: '💰 Prize', value: game.prize > 0 ? `💰 ${game.prize}` : '❌ *Not Set*', inline: true },
      { name: '👥 Players', value: `${game.maxPlayers}`, inline: true },
      { name: '🔮 Seer', value: game.seerMode, inline: true },
      { name: '🌙 Night', value: `${game.nightTime || 40}s/p`, inline: true },
      { name: '☀️ Day', value: `${game.dayTime || 60}s/p`, inline: true }
    )
    .setFooter({ text: 'Manual: rww setprize, rww setplayers, rww setseer, rww setnight, rww setday, rww launch' });
}

async function startInteractiveSetup(client, message, game) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('set_prize').setLabel('Prize').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('set_players').setLabel('Players').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_seer').setLabel('Seer Accuracy').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('set_night').setLabel('Night Timer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_day').setLabel('Day Timer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('launch').setLabel('🚀 Launch Lobby').setStyle(ButtonStyle.Success)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('exit').setLabel('Exit').setStyle(ButtonStyle.Danger)
  );

  const msg = await message.reply({ embeds: [generateSetupEmbed(game)], components: [row, row2, row3] });
  game.setupMsgId = msg.id;
  const collector = msg.createMessageComponentCollector({ time: 300000 });

  collector.on('collect', async (i) => {
    if (i.user.id !== game.host) return;

    if (i.customId === 'set_prize') {
      await i.reply({ content: '💬 Type the prize amount in chat...', ephemeral: true });
      const coll = message.channel.createMessageCollector({ 
        filter: m => m.author.id === game.host && !isNaN(m.content), 
        max: 1, 
        time: 30000 
      });
      coll.on('collect', m => {
        game.prize = parseInt(m.content);
        m.delete().catch(() => {});
        msg.edit({ embeds: [generateSetupEmbed(game)] });
      });
    }
    if (i.customId === 'set_players') {
      const counts = [5, 10, 15, 20];
      game.maxPlayers = counts[(counts.indexOf(game.maxPlayers) + 1) % counts.length];
      await i.update({ embeds: [generateSetupEmbed(game)] });
    }
    if (i.customId === 'set_seer') {
      game.seerMode = game.seerMode === 'EXACT' ? 'SIMPLE' : 'EXACT';
      await i.update({ embeds: [generateSetupEmbed(game)] });
    }
    if (i.customId === 'set_night') {
      const times = [40, 60, 80];
      game.nightTime = times[(times.indexOf(game.nightTime || 40) + 1) % times.length];
      await i.update({ embeds: [generateSetupEmbed(game)] });
    }
    if (i.customId === 'set_day') {
      const times = [60, 90, 120];
      game.dayTime = times[(times.indexOf(game.dayTime || 60) + 1) % times.length];
      await i.update({ embeds: [generateSetupEmbed(game)] });
    }
    if (i.customId === 'launch') {
      if (game.prize <= 0) return i.reply({ content: '❌ Set prize pool first!', ephemeral: true });
      collector.stop();
      i.update({ content: '🚀 Launching Lobby...', embeds: [], components: [] });
      launchLobby(client, message, game);
    }
    if (i.customId === 'exit') {
      client.werewolfGames.delete(message.channel.id);
      collector.stop();
      i.update({ content: '⭕ Setup closed.', embeds: [], components: [] });
    }
  });
}
