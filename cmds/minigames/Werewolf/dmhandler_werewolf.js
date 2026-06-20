/**
 * Handles prefix-less Werewolf minigame commands specifically in Direct Messages.
 */
module.exports = async (client, message, prefix, getConfig) => {
  if (message.guild) return false;

  const msgLower = message.content.toLowerCase().trim();

  // 1. Ready/Skip Logic
  if (msgLower === 'skip' || msgLower === 'ready') {
    const game = Array.from(client.werewolfGames.values()).find(g => 
      g.players.has(message.author.id) && 
      g.players.get(message.author.id).alive && 
      (g.status === 'NIGHT' || g.status === 'DAY')
    );
    if (game) { 
      game.players.get(message.author.id).ready = true; 
      await message.reply("✅ **Ready!**");
      return true;
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
    if (game) {
      await require('./engine.js').relayChat(client, game, message.author.id, message.content.slice(5).trim());
      return true;
    }
  }

  // 3. Kill Command
  if (msgLower.startsWith('k ') || msgLower.startsWith('kill ')) {
    const game = Array.from(client.werewolfGames.values()).find(g => 
      g.status === 'NIGHT' && 
      g.players.has(message.author.id) && 
      g.players.get(message.author.id).role === 'WEREWOLF' && 
      g.players.get(message.author.id).alive
    );
    if (game) {
      await require('./werewolf.js').run(client, message, ['kill', ...message.content.split(' ').slice(1)], prefix, getConfig());
      return true;
    }
  }

  // 4. Scan Command (Seer)
  if (msgLower.startsWith('sc ') || msgLower.startsWith('scan ')) {
    const game = Array.from(client.werewolfGames.values()).find(g => 
      g.status === 'NIGHT' && 
      g.players.has(message.author.id) && 
      g.players.get(message.author.id).role === 'SEER' && 
      g.players.get(message.author.id).alive
    );
    if (game) {
      await require('./werewolf.js').run(client, message, ['scan', ...message.content.split(' ').slice(1)], prefix, getConfig());
      return true;
    }
  }

  // 5. Vote Command
  if (msgLower.startsWith('v ') || msgLower.startsWith('vote ')) {
    const game = Array.from(client.werewolfGames.values()).find(g => 
      g.status === 'DAY' && 
      g.players.has(message.author.id) && 
      g.players.get(message.author.id).alive
    );
    if (game) {
      await require('./werewolf.js').run(client, message, ['vote', ...message.content.split(' ').slice(1)], prefix, getConfig());
      return true;
    }
  }

  return false;
};
