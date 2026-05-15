/**
 * Handles all prefix-less DM and Game-specific message interactions.
 * This keeps index.js clean and prevents game logic from breaking.
 */
module.exports = async (client, message, prefix, getConfig) => {
  const msgLower = message.content.toLowerCase().trim();

  // --- WEREWOLF DM COMMANDS ---
  if (!message.guild) {
    // 1. Ready/Skip Logic
    if (msgLower === 'skip' || msgLower === 'ready') {
      const game = Array.from(client.werewolfGames.values()).find(g => 
        g.players.has(message.author.id) && 
        g.players.get(message.author.id).alive && 
        (g.status === 'NIGHT' || g.status === 'DAY')
      );
      if (game) { 
        game.players.get(message.author.id).ready = true; 
        return message.reply("✅ **Ready!**"); 
      }
    }

    // 2. Werewolf Relay (wsay)
    if (msgLower.startsWith('wsay ')) {
      const game = Array.from(client.werewolfGames.values()).find(g => 
        g.status === 'NIGHT' && 
        g.players.has(message.author.id) && 
        g.players.get(message.author.id).role === 'WEREWOLF' && 
        g.players.get(message.author.id).alive
      );
      if (game) return require('../cmds/minigames/Werewolf/engine.js').relayChat(client, game, message.author.id, message.content.slice(5).trim());
    }

    // 3. Kill Command
    if (msgLower.startsWith('k ') || msgLower.startsWith('kill ')) {
      const game = Array.from(client.werewolfGames.values()).find(g => 
        g.status === 'NIGHT' && 
        g.players.has(message.author.id) && 
        g.players.get(message.author.id).role === 'WEREWOLF' && 
        g.players.get(message.author.id).alive
      );
      if (game) return require('../cmds/minigames/Werewolf/werewolf.js').run(client, message, ['kill', ...message.content.split(' ').slice(1)], prefix, getConfig());
    }

    // 4. Scan Command (Seer)
    if (msgLower.startsWith('sc ') || msgLower.startsWith('scan ')) {
      const game = Array.from(client.werewolfGames.values()).find(g => 
        g.status === 'NIGHT' && 
        g.players.has(message.author.id) && 
        g.players.get(message.author.id).role === 'SEER' && 
        g.players.get(message.author.id).alive
      );
      if (game) return require('../cmds/minigames/Werewolf/werewolf.js').run(client, message, ['scan', ...message.content.split(' ').slice(1)], prefix, getConfig());
    }

    // 5. Vote Command
    if (msgLower.startsWith('v ') || msgLower.startsWith('vote ')) {
      const game = Array.from(client.werewolfGames.values()).find(g => 
        g.status === 'DAY' && 
        g.players.has(message.author.id) && 
        g.players.get(message.author.id).alive
      );
      if (game) return require('../cmds/minigames/Werewolf/werewolf.js').run(client, message, ['vote', ...message.content.split(' ').slice(1)], prefix, getConfig());
    }

    // --- NAMEGUESSER DM COMMANDS ---
    if (msgLower.startsWith('g ') || msgLower.startsWith('guess ')) {
      const game = Array.from(client.nameGuesserGames.values()).find(g => 
        g.status === 'RUNNING' && 
        g.players.has(message.author.id)
      );
      if (game) return require('../cmds/minigames/NameGuesser/nameguesser.js').run(client, message, ['guess', ...message.content.split(' ').slice(1)], 'ng', getConfig());
    }
  }

  return false; // No DM command handled
};
