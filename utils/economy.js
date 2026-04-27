const fs = require('fs');
const path = require('path');

/**
 * Retrieves the UnbelievaBoat token for a specific guild.
 * Falls back to the global UNB_TOKEN from .env if no server-specific token exists.
 * @param {object} client - Discord Client
 * @param {string} guildId - The Discord Guild ID.
 * @returns {string} The API token to use for Authorization headers.
 */
function getEconomyToken(client, guildId) {
  // Check Cache First (Server-specific tokens)
  if (client.unbTokens.has(guildId)) {
    return client.unbTokens.get(guildId);
  }

  // Fallback ONLY for the main server (Global token from .env)
  const mainGuildId = process.env.MAIN_GUILD_ID?.trim().replace(/^["'](.+)["']$/, '$1');
  const globalToken = process.env.UNB_TOKEN?.trim().replace(/^["'](.+)["']$/, '$1');

  if (guildId === mainGuildId) {
    return globalToken;
  }

  return null;
}

/**
 * Saves a server-specific UnbelievaBoat token.
 * @param {object} client 
 * @param {string} guildId 
 * @param {string} token 
 */
function saveServerToken(client, guildId, token) {
  const tokensPath = path.join(__dirname, '../server_unbtokens.json');
  let data = { tokens: {} };
  
  if (fs.existsSync(tokensPath)) {
    data = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
  }
  
  if (!data.tokens) data.tokens = {};
  data.tokens[guildId] = token;
  
  fs.writeFileSync(tokensPath, JSON.stringify(data, null, 2));
  
  // Update Cache
  client.unbTokens.set(guildId, token);
}

/**
 * Removes a server-specific UnbelievaBoat token.
 * @param {object} client
 * @param {string} guildId 
 */
function removeServerToken(client, guildId) {
  const tokensPath = path.join(__dirname, '../server_unbtokens.json');
  if (fs.existsSync(tokensPath)) {
    const data = JSON.parse(fs.readFileSync(tokensPath, 'utf8'));
    if (data.tokens && data.tokens[guildId]) {
      delete data.tokens[guildId];
      fs.writeFileSync(tokensPath, JSON.stringify(data, null, 2));
      
      // Update Cache
      client.unbTokens.delete(guildId);
    }
  }
}

/**
 * Parses shorthand currency strings (e.g. 1k, 5.5m, 2b) into integers.
 * @param {string} str 
 * @returns {number} The parsed amount or NaN.
 */
function parseShorthand(str) {
  if (typeof str !== 'string') return NaN;
  const input = str.toLowerCase().trim();
  const match = input.match(/^([\d.]+)([kmbt]?)$/);
  if (!match) return NaN;

  const value = parseFloat(match[1]);
  const suffix = match[2];

  const multipliers = {
    'k': 1000,
    'm': 1000000,
    'b': 1000000000,
    't': 1000000000000
  };

  return Math.floor(value * (multipliers[suffix] || 1));
}

module.exports = {
  getEconomyToken,
  saveServerToken,
  removeServerToken,
  parseShorthand
};
