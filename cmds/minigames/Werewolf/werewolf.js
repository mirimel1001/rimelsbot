const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const axios = require('axios');
const fs = require('fs');

module.exports = {
  name: "werewolf",
  aliases: ["ww", "werewolf"],
  description: "Participate in the ultimate game of deception! (DM Commands Supported)\n" +
                "💰 *Note: 80% of host's prize is distributed to winners.*\n\n" +
                "**Players:** `join`, `leave`, `status`, `ready`, `dm`, `unvote`\n" +
                "**Actions:** `vote [ID]`, `kill [ID]`, `scan [ID]`\n" +
                "**Host:** `setup`, `launch`, `start`, `cancel`, `set[prize/wolves/scans/night/day]`",
  usage: "werewolf [setup/status/join/start/cancel/setprize/..]",
  run: async (client, message, args, prefix, config) => {
    registerWWListener(client);
    const subCommand = args[0]?.toLowerCase();
    let game = client.werewolfGames.get(message.channel.id);

    // DM Support: Find the game the user belongs to if in DMs
    if (!game && !message.guild) {
      game = Array.from(client.werewolfGames.values()).find(g => g.players.has(message.author.id));
    }

    // --- 1. SETUP COMMAND ---
    if (subCommand === 'setup') {
      if (game) return message.reply("⚠️ A Werewolf session is already active in this channel.");
      
      const newGame = {
        host: message.author.id,
        hostName: message.author.username,
        channelId: message.channel.id,
        guildId: message.guild.id,
        status: 'SETUP',
        prize: 0,
        maxPlayers: 10,
        wwCount: null,
        seerMode: 'SIMPLE',
        seerLimit: 2, // 2 scans per game by default
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
      
      const indexed = Array.from(game.players.entries())
        .filter(([id, p]) => p.alive)
        .sort((a, b) => a[1].name.localeCompare(b[1].name));
      
      const alive = indexed.map(([id, p], idx) => `${idx + 1}. **${p.name}**`).join('\n') || 'None';
      const dead = Array.from(game.players.values()).filter(p => !p.alive).map(p => `• ~~${p.name}~~`).join('\n') || 'None';
      
      const embed = new EmbedBuilder()
        .setColor('#2ECC71')
        .setTitle('📊 Werewolf Game Status')
        .setDescription(`**Phase:** ${game.status}\n**Prize:** 💰 ${game.prize}`)
        .addFields(
          { name: '👥 Alive', value: alive, inline: true },
          { name: '💀 Dead', value: dead, inline: true }
        );
      return message.reply({ embeds: [embed] });
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
      if (subCommand === 'setscans') {
        const val = parseInt(args[1]);
        if (isNaN(val) || val < 1) return message.reply("❌ Usage: `rww setscans [number]`");
        game.seerLimit = val;
        message.reply(`✅ Seer scan limit set to **${val}**.`);
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
      if (subCommand === 'setwolves') {
        const val = parseInt(args[1]);
        if (isNaN(val) || val < 1) return message.reply("❌ Usage: `rww setwolves [number]`");
        game.wwCount = val;
        message.reply(`✅ Werewolf count set to **${val}**.`);
        return refreshSetupUI(client, message, game);
      }
      if (subCommand === 'exit' || subCommand === 'cancel') {
        client.werewolfGames.delete(message.channel.id);
        return message.reply("⭕ Setup cancelled and closed.");
      }
      if (subCommand === 'launch') {
        if (game.prize <= 0) return message.reply("❌ Set prize pool first!");
        return launchLobby(client, message, game);
      }
    }

    // --- 4. GAME ACTIONS (MANUAL COMMANDS) ---
    if (game && (game.status === 'NIGHT' || game.status === 'DAY')) {
      const p = game.players.get(message.author.id);
      if (!p || !p.alive) return;

      const resolveTarget = (input) => {
        const indexed = Array.from(game.players.entries())
          .filter(([id, tp]) => tp.alive)
          .sort((a, b) => a[1].name.localeCompare(b[1].name));
        
        const num = parseInt(input);
        if (!isNaN(num) && num > 0 && num <= indexed.length) {
          return indexed[num - 1]; // Return [id, playerObj]
        }
        return indexed.find(([id, tp]) => tp.name.toLowerCase().includes(input.toLowerCase()));
      };

      if (subCommand === 'skip' || subCommand === 'ready') {
        p.ready = true;
        return message.reply("✅ Status: **Ready**.");
      }

      if (game.status === 'DAY' && (subCommand === 'vote' || subCommand === 'v')) {
        const targetInput = args.slice(1).join(' ');
        if (!targetInput) return message.reply("❌ Specify a player name or number.");
        const targetEntry = resolveTarget(targetInput);
        if (!targetEntry || targetEntry[0] === message.author.id) return message.reply("❌ Invalid target.");
        
        const engine = require('./engine.js');
        game.dayVotes.set(message.author.id, targetEntry[0]);
        await engine.logToHost(client, game, `🗳️ **Vote:** **${message.author.username}** voted for **${targetEntry[1].name}**`);
        return message.reply(`✅ Voted for **${targetEntry[1].name}**.`);
      }

      if (game.status === 'DAY' && (subCommand === 'unvote' || subCommand === 'cancel')) {
        if (!game.dayVotes.has(message.author.id)) return message.reply("⚠️ You haven't voted yet!");
        const targetId = game.dayVotes.get(message.author.id);
        const targetName = game.players.get(targetId)?.name || "Unknown";
        game.dayVotes.delete(message.author.id);
        const engine = require('./engine.js');
        await engine.logToHost(client, game, `❌ **Unvote:** **${message.author.username}** cancelled their vote for **${targetName}**.`);
        return message.reply("✅ Your vote has been **cancelled**.");
      }

      if (game.status === 'NIGHT' && (subCommand === 'kill' || subCommand === 'k')) {
        if (p.role !== 'WEREWOLF') return;
        if (message.guild) return message.reply("🤫 **Werewolf actions MUST be taken in DMs.** Check your private messages!");
        const targetInput = args.slice(1).join(' ');
        if (!targetInput) return message.reply("❌ Specify a player name or number.");
        const targetEntry = resolveTarget(targetInput);
        if (!targetEntry || targetEntry[1].role === 'WEREWOLF') return message.reply("❌ Invalid target.");
        
        const engine = require('./engine.js');
        const action = game.nightVote.has(message.author.id) ? "switched their target to" : "selected to kill";
        game.nightVote.set(message.author.id, targetEntry[0]);
        await engine.logToHost(client, game, `🔪 **Targeting:** **${message.author.username}** ${action} **${targetEntry[1].name}**`);
        return message.reply(`✅ Selection: **${targetEntry[1].name}**.`);
      }

      if (game.status === 'NIGHT' && (subCommand === 'scan' || subCommand === 'sc')) {
        if (p.role !== 'SEER') return;
        if (message.guild) return message.reply("🔮 **Seer scans MUST be taken in DMs.** Check your private messages!");
        if (p.scannedThisNight) return message.reply("⚠️ You have already scanned someone tonight!");
        if (game.seerLimit !== null && p.scans <= 0) return message.reply("❌ No scans left represent!");
        const targetInput = args.slice(1).join(' ');
        if (!targetInput) return message.reply("❌ Specify a player name or number.");
        const targetEntry = resolveTarget(targetInput);
        if (!targetEntry || targetEntry[0] === message.author.id) return message.reply("❌ Invalid target.");
        
        if (game.seerLimit !== null) p.scans--;
        p.scannedThisNight = true;
        let res = targetEntry[1].role;
        if (game.seerMode === 'SIMPLE') res = targetEntry[1].role === 'WEREWOLF' ? 'WEREWOLF' : 'NOT a Werewolf';
        
        const engine = require('./engine.js');
        await engine.logToHost(client, game, `🔮 **Seer Scan:** **${p.name}** scanned **${targetEntry[1].name}** and saw: **${res}** (Remaining scans: ${p.scans ?? '∞'})`);
        return message.reply(`🔮 Your vision reveals: **${targetEntry[1].name}** is a **${res}**.\n*Remaining scans: ${p.scans ?? '∞'}*`);
      }

      if (subCommand === 'wsay' || subCommand === 'w') {
        if (p.role !== 'WEREWOLF') return;
        const text = args.slice(1).join(' ');
        if (!text) return message.reply("❌ Usage: `rww wsay [text]`");
        const engine = require('./engine.js');
        await engine.relayChat(client, game, message.author.id, text);
        return message.reply(`✅ Sent to pack: "${text}"`);
      }

      if (subCommand === 'dm') {
        const engine = require('./engine.js');
        if (!p.lastPrompt) return message.reply("❌ No prompt found.");
        await engine.safeDM(client, game, message.author.id, p.lastPrompt.content, p.lastPrompt.options);
        return message.reply("📥 Sent prompt again. Check DMs!");
      }
    }
    // --- 3. LOBBY COMMANDS ---
    if (game && game.status === 'LOBBY') {
      if (subCommand === 'join') {
        if (game.players.has(message.author.id)) return message.reply("⚠️ Already in!");
        if (game.players.size >= game.maxPlayers) return message.reply("⚠️ Lobby full!");
        game.players.set(message.author.id, { name: message.author.username, role: null, alive: true, ready: false });
        return message.reply("✅ **Joined!** ⚠️ **IMPORTANT:** Please ensure you have **'Allow Direct Messages from other members in this server'** enabled in your **Privacy Settings** for this server so the bot can send you your secret role and prompts!");
      }
      if (subCommand === 'leave') {
        game.players.delete(message.author.id);
        return message.reply("👋 Left.");
      }
      if (subCommand === 'start' || subCommand === 'launch') {
        if (message.author.id !== game.host) return;
        if (game.players.size < 4) return message.reply("⚠️ Need 4 players!");
        return startGame(client, message.channel, game);
      }
      if (subCommand === 'cancel' || subCommand === 'exit') {
        if (message.author.id !== game.host) return;
        await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${game.guildId}/users/${game.host}`, { cash: game.prize }, {
          headers: { 'Authorization': process.env.UNB_TOKEN }
        });
        client.werewolfGames.delete(game.channelId);
        return message.reply("⭕ Game cancelled and funds returned.");
      }
    }

    if (!game && !subCommand) return message.reply(`🐺 Use \`${prefix}ww setup\` to start an event!`);
  }
};

async function launchLobby(client, message, game) {
  try {
    await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${game.guildId}/users/${game.host}`, { cash: -game.prize }, {
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
    .setDescription(`**Host:** <@${game.host}>\n**Prize Pool:** 💰 ${game.prize}\n**Players:** ${game.players.size}/${game.maxPlayers}`)
    .setFooter({ text: 'Manual: rww join, rww leave, rww start, rww cancel' });

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
      if (g.players.has(i.user.id)) return i.reply({ content: 'Already in!', flags: [MessageFlags.Ephemeral] });
      if (g.players.size >= g.maxPlayers) return i.reply({ content: 'Full!', flags: [MessageFlags.Ephemeral] });
      g.players.set(i.user.id, { id: i.user.id, name: i.user.username, role: null, alive: true, ready: false });
      i.reply({ content: '✅ Joined!', flags: [MessageFlags.Ephemeral] });
      updateLobbyUI(msg, g);
    }
    if (i.customId === 'ww_leave') {
      g.players.delete(i.user.id);
      i.reply({ content: '👋 Left.', flags: [MessageFlags.Ephemeral] });
      updateLobbyUI(msg, g);
    }
    if (i.customId === 'ww_start') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      if (g.players.size < 4) return i.reply({ content: 'Need 4 players!', flags: [MessageFlags.Ephemeral] });
      collector.stop();
      startGame(client, i.channel, g);
    }
    if (i.customId === 'ww_cancel') {
      if (i.user.id !== g.host) return i.reply({ content: 'Host only.', flags: [MessageFlags.Ephemeral] });
      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${g.guildId}/users/${g.host}`, { cash: g.prize }, {
        headers: { 'Authorization': process.env.UNB_TOKEN }
      });
      client.werewolfGames.delete(i.channelId);
      collector.stop();
      i.update({ content: '⭕ Cancelled.', embeds: [], components: [] });
    }
  });
}

function updateLobbyUI(msg, game) {
  const embed = new EmbedBuilder(msg.embeds[0].data)
    .setDescription(`**Host:** <@${game.host}>\n**Prize Pool:** 💰 ${game.prize}\n**Players:** ${game.players.size}/${game.maxPlayers}`);
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
    await msg.edit({ embeds: [generateSetupEmbed(game)] });
  } catch (e) {}
}

function generateSetupEmbed(game) {
  return new EmbedBuilder()
    .setColor('#5865F2')
    .setTitle('🌑 Werewolf Setup: Configuration')
    .addFields(
      { name: '💰 Prize', value: game.prize > 0 ? `💰 ${game.prize}` : '❌ *Not Set*', inline: true },
      { name: '👥 Players', value: `${game.maxPlayers}`, inline: true },
      { name: '🐺 Wolves', value: game.wwCount ? `${game.wwCount}` : 'Auto', inline: true },
      { name: '🔮 Seer', value: `${game.seerMode} (${game.seerLimit ?? '∞'} scans total)`, inline: true },
      { name: '🌙 Night', value: `${game.nightTime}s/p`, inline: true },
      { name: '☀️ Day', value: `${game.dayTime}s/p`, inline: true }
    )
    .setFooter({ text: 'Manual: rww setprize, rww setplayers, rww setwolves, rww setscans, rww setseer, rww setnight, rww setday, rww launch, rww exit' });
}

async function startInteractiveSetup(client, message, game) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('set_prize').setLabel('Prize').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('set_players').setLabel('Players').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_wolves').setLabel('Wolves').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('set_seer').setLabel('Seer Accuracy').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_scans').setLabel('Seer Scans').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('set_night').setLabel('Night Timer').setStyle(ButtonStyle.Secondary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('set_day').setLabel('Day Timer').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('launch').setLabel('🚀 Launch Lobby').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('exit').setLabel('Exit').setStyle(ButtonStyle.Danger)
  );

  const msg = await message.reply({ embeds: [generateSetupEmbed(game)], components: [row, row2, row3] });
  game.setupMsgId = msg.id;
  const collector = msg.createMessageComponentCollector({ time: 300000 });

  collector.on('collect', async (i) => {
    if (i.user.id !== game.host) return;

    if (i.customId === 'set_prize') {
      await i.reply({ content: '💬 Type amount:', flags: [MessageFlags.Ephemeral] });
      const coll = message.channel.createMessageCollector({ filter: m => m.author.id === game.host && !isNaN(m.content), max: 1, time: 30000 });
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
    if (i.customId === 'set_wolves') {
      const counts = [null, 1, 2, 3, 4];
      game.wwCount = counts[(counts.indexOf(game.wwCount || null) + 1) % counts.length];
      await i.update({ embeds: [generateSetupEmbed(game)] });
    }
    if (i.customId === 'set_scans') {
      const limits = [null, 1, 2, 3, 5];
      game.seerLimit = limits[(limits.indexOf(game.seerLimit || null) + 1) % limits.length];
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
      if (game.prize <= 0) return i.reply({ content: '❌ Set prize first!', flags: [MessageFlags.Ephemeral] });
      collector.stop();
      i.update({ content: '🚀 Launching...', embeds: [], components: [] });
      launchLobby(client, message, game);
    }
    if (i.customId === 'exit') {
      client.werewolfGames.delete(message.channel.id);
      collector.stop();
      i.update({ content: '⭕ Exit.', embeds: [], components: [] });
    }
  });
}

function registerWWListener(client) {
  if (client.wwListenerRegistered) return;
  client.wwListenerRegistered = true;

  client.on('interactionCreate', async (i) => {
    if (!i.isButton() && !i.isStringSelectMenu()) return;
    const g = Array.from(client.werewolfGames.values()).find(game => game.players.has(i.user.id));
    if (!g) return;
    const p = g.players.get(i.user.id);
    if (!p || !p.alive) return;

    const engine = require('./engine.js');

    if (i.customId === 'ww_ready') {
      p.ready = true;
      return i.reply({ content: '✅ Ready!', flags: [MessageFlags.Ephemeral] });
    }
    if (i.customId === 'ww_vote_open') {
      const options = Array.from(g.players.entries())
        .filter(([id, tp]) => tp.alive && id !== i.user.id)
        .map(([id, tp]) => ({ label: tp.name, value: id }));
      
      if (options.length === 0) return i.reply({ content: '❌ No targets.', flags: [MessageFlags.Ephemeral] });
      const menu = new StringSelectMenuBuilder().setCustomId('ww_vote_cast').setPlaceholder('Vote...').addOptions(options);
      return i.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: [MessageFlags.Ephemeral] });
    }
    if (i.customId === 'ww_vote_cancel') {
      if (!g.dayVotes.has(i.user.id)) return i.reply({ content: "⚠️ You haven't voted yet!", flags: [MessageFlags.Ephemeral] });
      const targetId = g.dayVotes.get(i.user.id);
      const targetName = g.players.get(targetId)?.name || "Unknown";
      g.dayVotes.delete(i.user.id);
      await engine.logToHost(client, g, `❌ **Unvote:** **${i.user.username}** cancelled their vote for **${targetName}**.`);
      return i.reply({ content: "✅ Your vote has been **cancelled**.", flags: [MessageFlags.Ephemeral] });
    }
    if (i.customId === 'ww_vote_cast') {
      g.dayVotes.set(i.user.id, i.values[0]);
      await engine.logToHost(client, g, `🗳️ **Vote:** **${i.user.username}** voted for **${g.players.get(i.values[0]).name}**`);
      return i.update({ content: `✅ Voted for **${g.players.get(i.values[0]).name}**`, components: [] });
    }
    if (i.customId === 'ww_kill') {
      if (g.status !== 'NIGHT') return i.reply({ content: 'Night phase is over.', flags: [MessageFlags.Ephemeral] });
      const action = g.nightVote.has(i.user.id) ? "switched their target to" : "selected";
      g.nightVote.set(i.user.id, i.values[0]);
      await engine.logToHost(client, g, `🔪 **Targeting:** **${i.user.username}** ${action} **${g.players.get(i.values[0]).name}** to kill.`);
      return i.update({ content: `✅ Selected **${g.players.get(i.values[0]).name}**`, components: [] });
    }
    
    if (i.customId === 'ww_scan') {
      const engine = require('./engine.js');
      if (g.status !== 'NIGHT') return i.reply({ content: 'Night phase is over.', flags: [MessageFlags.Ephemeral] });
      if (p.scannedThisNight) return i.reply({ content: "⚠️ You have already scanned someone tonight!", flags: [MessageFlags.Ephemeral] });
      if (g.seerLimit !== null && p.scans <= 0) return i.reply({ content: "❌ No scans left for this game!", flags: [MessageFlags.Ephemeral] });
      if (g.seerLimit !== null) p.scans--;
      p.scannedThisNight = true;
      const target = g.players.get(i.values[0]);
      let res = target.role;
      if (g.seerMode === 'SIMPLE') res = target.role === 'WEREWOLF' ? 'WEREWOLF' : 'NOT a Werewolf';
      await engine.logToHost(client, g, `🔮 **Seer Scan:** **${p.name}** scanned **${target.name}** saw **${res}** (Remaining: ${p.scans ?? '∞'})`);
      return i.update({ content: `🔮 Vision: **${target.name}** is a **${res}**.\n*Remaining in game: ${p.scans ?? '∞'}*`, components: [] });
    }
  });
}
