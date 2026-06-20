/**
 * Handles prefix-less NameGuesser minigame commands specifically in Direct Messages.
 */
module.exports = async (client, message, prefix, getConfig) => {
  if (message.guild) return false;

  const msgLower = message.content.toLowerCase().trim();

  // 1. NG / RNG Command triggers
  if (msgLower.startsWith('ng ') || msgLower.startsWith('rng ')) {
    const game = Array.from(client.nameGuesserGames.values()).find(g => 
      (g.host === message.author.id || g.players.has(message.author.id))
    );
    if (game) {
      const commandArgs = message.content.trim().split(/ +/).slice(1);
      await require('./nameguesser.js').run(client, message, commandArgs, 'ng', getConfig());
      return true;
    }
  }

  // 2. Guess Command
  if (msgLower.startsWith('g ') || msgLower.startsWith('guess ')) {
    const game = Array.from(client.nameGuesserGames.values()).find(g => 
      g.status === 'RUNNING' && 
      g.players.has(message.author.id)
    );
    if (game) {
      await require('./nameguesser.js').run(client, message, ['guess', ...message.content.split(' ').slice(1)], 'ng', getConfig());
      return true;
    }
  }

  // 3. List Identities / Secrets
  if (msgLower === 'list' || msgLower === 'identities' || msgLower === 'secret' || msgLower === 'secrets') {
    const game = Array.from(client.nameGuesserGames.values()).find(g => 
      g.status === 'RUNNING' && 
      (g.host === message.author.id || g.players.has(message.author.id))
    );
    if (game) {
      await require('./nameguesser.js').run(client, message, ['identities'], 'ng', getConfig());
      return true;
    }
  }

  // 4. Yes/No voting
  if (msgLower === 'yes' || msgLower === 'no' || msgLower === 'y' || msgLower === 'n') {
    const game = Array.from(client.nameGuesserGames.values()).find(g => 
      g.status === 'RUNNING' && 
      g.currentQuestion &&
      (g.host === message.author.id || g.players.has(message.author.id))
    );
    if (game) {
      const choice = (msgLower === 'yes' || msgLower === 'y') ? 'yes' : 'no';
      await require('./nameguesser.js').run(client, message, ['vote', choice], 'ng', getConfig());
      return true;
    }
  }

  return false;
};
