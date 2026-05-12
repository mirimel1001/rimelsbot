const fs = require('fs');
const path = require('path');
const axios = require('axios');

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
 * Audits a specific user's balance and redacts excess if they exceed the max balance limit.
 * @param {object} client - Discord Client
 * @param {string} guildId - Guild ID
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} Result of redaction or null
 */
async function enforceMaxBalance(client, guildId, userId) {
  const token = getEconomyToken(client, guildId);
  if (!token) return null;

  try {
    // 1. Load Configs
    const customPath = path.join(__dirname, '../custom_guilds.json');
    const defaultPath = path.join(__dirname, '../default_myserver.json');
    if (!fs.existsSync(customPath) || !fs.existsSync(defaultPath)) return null;

    const customData = JSON.parse(fs.readFileSync(customPath, 'utf8'));
    const defaultData = JSON.parse(fs.readFileSync(defaultPath, 'utf8'));

    const guildData = customData.guilds[guildId] || {};
    let maxBal = guildData.maxBalance;

    if (maxBal === false) return null;
    if (maxBal === undefined) {
      const mainGuildId = process.env.MAIN_GUILD_ID?.trim().replace(/^["'](.+)["']$/, '$1');
      if (guildId === mainGuildId) {
        maxBal = defaultData.maxBalance;
      } else {
        return null; 
      }
    }

    // 2. Fetch User Data
    const res = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${guildId}/users/${userId}`, {
      headers: { 'Authorization': token }
    });

    const cash = parseFloat(res.data.cash) || 0;
    const bank = parseFloat(res.data.bank) || 0;
    const total = cash + bank;

    if (total > maxBal) {
      const excess = total - maxBal;
      
      // Redact from Cash first, then Bank
      let redactCash = Math.min(cash, excess);
      let redactBank = Math.max(0, excess - redactCash);

      await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${guildId}/users/${userId}`, {
        cash: -redactCash,
        bank: -redactBank,
        reason: "Max balance limit exceeded (Reactive Audit)"
      }, {
        headers: { 'Authorization': token }
      });

      console.log(`[MaxBalance] Reactive Redaction: Redacted ${formatNumber(excess)} from ${userId} in ${guildId}`);
      return { redacted: excess, userId };
    }
  } catch (err) {
    if (err.response?.status !== 404) {
      console.error(`[MaxBalance Error] Reactive check failed for ${userId} in ${guildId}:`, err.message);
    }
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
  const customPath = path.join(__dirname, '../custom_guilds.json');
  let data = { unbTokens: {}, guilds: {} };
  
  if (fs.existsSync(customPath)) {
    data = JSON.parse(fs.readFileSync(customPath, 'utf8'));
  }
  
  if (!data.unbTokens) data.unbTokens = {};
  data.unbTokens[guildId] = token;
  
  fs.writeFileSync(customPath, JSON.stringify(data, null, 2));
  
  // Update Cache
  client.unbTokens.set(guildId, token);
}

/**
 * Removes a server-specific UnbelievaBoat token.
 * @param {object} client
 * @param {string} guildId 
 */
function removeServerToken(client, guildId) {
  const customPath = path.join(__dirname, '../custom_guilds.json');
  if (fs.existsSync(customPath)) {
    const data = JSON.parse(fs.readFileSync(customPath, 'utf8'));
    if (data.unbTokens && data.unbTokens[guildId]) {
      delete data.unbTokens[guildId];
      fs.writeFileSync(customPath, JSON.stringify(data, null, 2));
      
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

/**
 * Formats a number with commas for better readability.
 * @param {number|string} val 
 * @returns {string}
 */
function formatNumber(val) {
  if (val === null || val === undefined || val === false) return "0";
  const num = parseFloat(val);
  if (isNaN(num)) return val.toString();
  return num.toLocaleString('en-US');
}

/**
 * Checks total wealth and deducts funds from cash/bank as needed.
 * @param {object} client 
 * @param {string} guildId 
 * @param {string} userId 
 * @param {number} amount 
 * @param {string} reason 
 * @returns {Promise<object>} Result object with success status.
 */
async function deductFunds(client, guildId, userId, amount, reason = "NameGuesser Prize Pool") {
  const token = getEconomyToken(client, guildId);
  if (!token) throw new Error("No economy token found.");

  const res = await axios.get(`https://unbelievaboat.com/api/v1/guilds/${guildId}/users/${userId}`, {
    headers: { 'Authorization': token }
  });

  const cash = parseFloat(res.data.cash) || 0;
  const bank = parseFloat(res.data.bank) || 0;
  const total = cash + bank;

  if (total < amount) return { success: false, error: `Insufficient total wealth. You have **${formatNumber(total)}** but need **${formatNumber(amount)}**.` };

  const deductCash = Math.min(cash, amount);
  const deductBank = amount - deductCash;

  await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${guildId}/users/${userId}`, {
    cash: -deductCash,
    bank: -deductBank,
    reason: reason
  }, {
    headers: { 'Authorization': token }
  });

  return { success: true, deductCash, deductBank };
}

/**
 * Refunds funds to the user's cash balance.
 * @param {object} client 
 * @param {string} guildId 
 * @param {string} userId 
 * @param {number} amount 
 * @param {string} reason 
 */
async function refundFunds(client, guildId, userId, amount, reason = "NameGuesser Refund") {
  if (amount <= 0) return;
  const token = getEconomyToken(client, guildId);
  if (!token) throw new Error("No economy token found.");
  
  await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${guildId}/users/${userId}`, {
    cash: amount,
    reason: reason
  }, {
    headers: { 'Authorization': token }
  });
}

module.exports = {
  getEconomyToken,
  saveServerToken,
  removeServerToken,
  parseShorthand,
  enforceMaxBalance,
  formatNumber,
  deductFunds,
  refundFunds
};
