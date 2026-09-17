const mysql = require('mysql2/promise');

let pool = null;

const initMySQL = async () => {
  if (pool) return pool;

  try {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST,
      port: parseInt(process.env.MYSQL_PORT) || 3306,
      user: process.env.MYSQL_USER,
      password: process.env.MYSQL_PASSWORD,
      database: process.env.MYSQL_DATABASE,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0
    });

    // Test connection
    const connection = await pool.getConnection();
    console.log('[MySQL] Connected to database successfully!');
    
    // Initialize Table
    await connection.query(`
      CREATE TABLE IF NOT EXISTS activity_messages (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(30) NOT NULL,
        user_id VARCHAR(30) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_guild_time (guild_id, user_id, created_at)
      )
    `);
    console.log('[MySQL] Verified activity_messages table structure.');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS left_users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        guild_id VARCHAR(30) NOT NULL,
        user_id VARCHAR(30) NOT NULL,
        username VARCHAR(100) NOT NULL,
        left_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_user_guild (guild_id, user_id)
      )
    `);
    console.log('[MySQL] Verified left_users table structure.');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS activity_roles (
        id VARCHAR(10) PRIMARY KEY,
        guild_id VARCHAR(30) NOT NULL,
        role_id VARCHAR(30) NOT NULL,
        name VARCHAR(100) NOT NULL,
        req_msgs INT DEFAULT 5,
        log_channel VARCHAR(30) DEFAULT 'same',
        admin_log_channel VARCHAR(30) DEFAULT NULL,
        delete_log BOOLEAN DEFAULT FALSE,
        delete_time INT DEFAULT 60,
        custom_message TEXT DEFAULT NULL,
        remove_role BOOLEAN DEFAULT FALSE,
        INDEX idx_guild (guild_id)
      )
    `);
    console.log('[MySQL] Verified activity_roles table structure.');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS ar_dm_users (
        guild_id VARCHAR(30) NOT NULL,
        user_id VARCHAR(30) NOT NULL,
        PRIMARY KEY (guild_id, user_id)
      )
    `);
    console.log('[MySQL] Verified ar_dm_users table structure.');

    await connection.query(`
      CREATE TABLE IF NOT EXISTS count_activities (
        id INT AUTO_INCREMENT PRIMARY KEY,
        activity_id VARCHAR(20) NOT NULL UNIQUE,
        guild_id VARCHAR(30) NOT NULL,
        channel_id VARCHAR(30) NOT NULL,
        name VARCHAR(100) NOT NULL,
        current_number INT DEFAULT 0,
        last_user_id VARCHAR(30) DEFAULT NULL,
        last_bot_message_id VARCHAR(30) DEFAULT NULL,
        high_score INT DEFAULT 0,
        strict_mode BOOLEAN DEFAULT FALSE,
        allow_consecutive BOOLEAN DEFAULT FALSE,
        delete_consecutive BOOLEAN DEFAULT TRUE,
        reaction_emoji VARCHAR(100) DEFAULT '✅',
        delete_chat BOOLEAN DEFAULT FALSE,
        show_last BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_guild_channel (guild_id, channel_id),
        INDEX idx_channel (channel_id)
      )
    `);
    console.log('[MySQL] Verified count_activities table structure.');
    
    connection.release();
    return pool;
  } catch (err) {
    console.error('[MySQL Error] Connection or Initialization failed:', err);
    pool = null;
    throw err;
  }
};

const getPool = () => {
  if (!pool) {
    throw new Error('MySQL connection pool has not been initialized. Call initMySQL() first.');
  }
  return pool;
};

const logMessageActivity = async (guildId, userId) => {
  if (!pool) return; // Silently ignore if pool is offline/uninitialized to prevent log spam
  try {
    const dbPool = getPool();
    await dbPool.query(
      'INSERT INTO activity_messages (guild_id, user_id) VALUES (?, ?)',
      [guildId, userId]
    );
  } catch (err) {
    console.error('[MySQL Error] Failed to log message activity:', err.message);
  }
};

/**
 * Get the message count for a user in the last N days
 * @param {string} guildId 
 * @param {string} userId 
 * @param {number} days 
 * @returns {Promise<number>}
 */
const getMessageCount = async (guildId, userId, days = 14) => {
  if (!pool) return 0; // Return 0 silently if database is offline
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query(
      `SELECT COUNT(*) AS msg_count FROM activity_messages 
       WHERE guild_id = ? AND user_id = ? AND created_at > NOW() - INTERVAL ? DAY`,
      [guildId, userId, days]
    );
    return rows[0]?.msg_count || 0;
  } catch (err) {
    console.error('[MySQL Error] Failed to get message count:', err.message);
    return 0;
  }
};

/**
 * Prune messages older than N days
 * @param {number} days 
 */
const pruneOldMessages = async (days = 14) => {
  if (!pool) return; // Return silently if database is offline
  try {
    const dbPool = getPool();
    const [result] = await dbPool.query(
      'DELETE FROM activity_messages WHERE created_at < NOW() - INTERVAL ? DAY',
      [days]
    );
    // console.log(`[MySQL Cleanup] Pruned ${result.affectedRows} messages older than ${days} days.`);

    const [leftResult] = await dbPool.query(
      'DELETE FROM left_users WHERE left_at < NOW() - INTERVAL ? DAY',
      [days]
    );
    // console.log(`[MySQL Cleanup] Pruned ${leftResult.affectedRows} left users older than ${days} days.`);
  } catch (err) {
    console.error('[MySQL Cleanup Error] Failed to prune messages:', err.message);
  }
};

/**
 * Check if database is connected
 * @returns {Promise<boolean>}
 */
const checkConnection = async () => {
  if (!pool) return false;
  try {
    const connection = await pool.getConnection();
    connection.release();
    return true;
  } catch (err) {
    return false;
  }
};

/**
 * Delete a user's message activity from a guild
 * @param {string} guildId 
 * @param {string} userId 
 */
const removeUserActivity = async (guildId, userId) => {
  if (!pool) return;
  try {
    const dbPool = getPool();
    const [result] = await dbPool.query(
      'DELETE FROM activity_messages WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    // console.log(`[MySQL Cleanup] Removed activity messages for user ${userId} in guild ${guildId} (${result.affectedRows} rows).`);
  } catch (err) {
    console.error('[MySQL Cleanup Error] Failed to remove user activity:', err.message);
  }
};

/**
 * Log a user who left the server
 * @param {string} guildId 
 * @param {string} userId 
 * @param {string} username 
 */
const addLeftUser = async (guildId, userId, username) => {
  if (!pool) return;
  try {
    const dbPool = getPool();
    await dbPool.query(
      'DELETE FROM left_users WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    await dbPool.query(
      'INSERT INTO left_users (guild_id, user_id, username) VALUES (?, ?, ?)',
      [guildId, userId, username]
    );
    // console.log(`[MySQL] Logged left user: ${username} (${userId}) in guild ${guildId}`);
  } catch (err) {
    console.error('[MySQL Error] Failed to add left user:', err.message);
  }
};

/**
 * Remove a user from left_users when they rejoin
 * @param {string} guildId 
 * @param {string} userId 
 */
const removeLeftUser = async (guildId, userId) => {
  if (!pool) return;
  try {
    const dbPool = getPool();
    await dbPool.query(
      'DELETE FROM left_users WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    // console.log(`[MySQL] Removed left user record for user ${userId} in guild ${guildId}`);
  } catch (err) {
    console.error('[MySQL Error] Failed to remove left user:', err.message);
  }
};

/**
 * Get all left users for a guild
 * @param {string} guildId 
 * @returns {Promise<Array>}
 */
const getLeftUsers = async (guildId) => {
  if (!pool) return [];
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query(
      'SELECT user_id, username FROM left_users WHERE guild_id = ?',
      [guildId]
    );
    return rows;
  } catch (err) {
    console.error('[MySQL Error] Failed to get left users:', err.message);
    return [];
  }
};

/**
 * Wipe all or a specific number of message activity records for a user from a guild
 * @param {string} guildId 
 * @param {string} userId 
 * @param {number|null} limit - If specified, deletes only the latest N messages. Otherwise deletes all.
 * @returns {Promise<number>} Number of deleted messages
 */
const wipeUserActivity = async (guildId, userId, limit = null) => {
  if (!pool) return 0;
  try {
    const dbPool = getPool();
    let result;
    if (limit && Number.isInteger(limit) && limit > 0) {
      [result] = await dbPool.query(
        'DELETE FROM activity_messages WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?',
        [guildId, userId, limit]
      );
    } else {
      [result] = await dbPool.query(
        'DELETE FROM activity_messages WHERE guild_id = ? AND user_id = ?',
        [guildId, userId]
      );
    }
    return result.affectedRows || 0;
  } catch (err) {
    console.error('[MySQL Error] Failed to wipe user activity:', err.message);
    throw err;
  }
};

/**
 * Get message counts for all active users in a guild in the last N days
 * @param {string} guildId 
 * @param {number} days 
 * @returns {Promise<Map<string, number>>}
 */
const getGuildMessageCounts = async (guildId, days = 14) => {
  if (!pool) return new Map();
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query(
      'SELECT user_id, COUNT(*) as count FROM activity_messages WHERE guild_id = ? AND created_at > NOW() - INTERVAL ? DAY GROUP BY user_id',
      [guildId, days]
    );
    const countsMap = new Map();
    rows.forEach(row => {
      countsMap.set(row.user_id, Number(row.count) || 0);
    });
    return countsMap;
  } catch (err) {
    console.error('[MySQL Error] Failed to get guild message counts:', err.message);
    return new Map();
  }
};

/**
 * Fetch all activity role configurations from MySQL
 * @returns {Promise<Array>}
 */
const getAllActivityRoles = async () => {
  if (!pool) return [];
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query('SELECT * FROM activity_roles');
    return rows.map(row => ({
      id: row.id,
      guildId: row.guild_id,
      roleId: row.role_id,
      name: row.name,
      req_msgs: row.req_msgs,
      logChannel: row.log_channel,
      adminLogChannel: row.admin_log_channel,
      deleteLog: Boolean(row.delete_log),
      deleteTime: row.delete_time,
      customMessage: row.custom_message,
      removeRole: Boolean(row.remove_role)
    }));
  } catch (err) {
    console.error('[MySQL Error] Failed to get all activity roles:', err.message);
    return [];
  }
};

/**
 * Save or update an activity role configuration in MySQL
 * @param {string} guildId 
 * @param {object} config 
 */
const saveActivityRole = async (guildId, config) => {
  if (!pool) return;
  try {
    const dbPool = getPool();
    await dbPool.query(
      `REPLACE INTO activity_roles 
       (id, guild_id, role_id, name, req_msgs, log_channel, admin_log_channel, delete_log, delete_time, custom_message, remove_role) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        config.id,
        guildId,
        config.roleId,
        config.name,
        config.req_msgs ?? 5,
        config.logChannel ?? 'same',
        config.adminLogChannel ?? null,
        config.deleteLog ? 1 : 0,
        config.deleteTime ?? 60,
        config.customMessage ?? null,
        config.removeRole ? 1 : 0
      ]
    );
  } catch (err) {
    console.error('[MySQL Error] Failed to save activity role:', err.message);
    throw err;
  }
};

/**
 * Delete an activity role configuration from MySQL
 * @param {string} guildId 
 * @param {string} id 
 */
const deleteActivityRole = async (guildId, id) => {
  if (!pool) return;
  try {
    const dbPool = getPool();
    await dbPool.query(
      'DELETE FROM activity_roles WHERE guild_id = ? AND id = ?',
      [guildId, id]
    );
  } catch (err) {
    console.error('[MySQL Error] Failed to delete activity role:', err.message);
    throw err;
  }
};

/**
 * Fetch all DM enabled users from MySQL
 * @returns {Promise<Array>}
 */
const getAllDmEnabledUsers = async () => {
  if (!pool) return [];
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query('SELECT * FROM ar_dm_users');
    return rows;
  } catch (err) {
    console.error('[MySQL Error] Failed to get all DM enabled users:', err.message);
    return [];
  }
};

/**
 * Toggle a user's DM notification preference for a guild in MySQL
 * @param {string} guildId 
 * @param {string} userId 
 * @returns {Promise<boolean>} The new status (true = enabled, false = disabled)
 */
const toggleDmEnabledUser = async (guildId, userId) => {
  if (!pool) return false;
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query(
      'SELECT 1 FROM ar_dm_users WHERE guild_id = ? AND user_id = ?',
      [guildId, userId]
    );
    if (rows.length > 0) {
      await dbPool.query(
        'DELETE FROM ar_dm_users WHERE guild_id = ? AND user_id = ?',
        [guildId, userId]
      );
      return false;
    } else {
      await dbPool.query(
        'INSERT INTO ar_dm_users (guild_id, user_id) VALUES (?, ?)',
        [guildId, userId]
      );
      return true;
    }
  } catch (err) {
    console.error('[MySQL Error] Failed to toggle DM enabled user:', err.message);
    throw err;
  }
};


/**
 * Map raw MySQL row to camelCase count activity object
 */
const mapCountRow = (row) => {
  if (!row) return null;
  return {
    id: row.id,
    activityId: row.activity_id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    name: row.name,
    currentNumber: Number(row.current_number) || 0,
    lastUserId: row.last_user_id,
    lastBotMessageId: row.last_bot_message_id,
    highScore: Number(row.high_score) || 0,
    strictMode: Boolean(row.strict_mode),
    allowConsecutive: Boolean(row.allow_consecutive),
    deleteConsecutive: Boolean(row.delete_consecutive),
    reactionEmoji: row.reaction_emoji || '✅',
    deleteChat: Boolean(row.delete_chat),
    showLast: Boolean(row.show_last),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
};

/**
 * Get all active counting activities across all servers
 * @returns {Promise<Array>}
 */
const getAllCountActivities = async () => {
  if (!pool) return [];
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query('SELECT * FROM count_activities WHERE is_active = TRUE');
    return rows.map(mapCountRow);
  } catch (err) {
    console.error('[MySQL Error] Failed to get all count activities:', err.message);
    return [];
  }
};

/**
 * Get all counting activities for a specific guild
 * @param {string} guildId 
 * @returns {Promise<Array>}
 */
const getCountActivitiesByGuild = async (guildId) => {
  if (!pool) return [];
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query('SELECT * FROM count_activities WHERE guild_id = ? ORDER BY id ASC', [guildId]);
    return rows.map(mapCountRow);
  } catch (err) {
    console.error('[MySQL Error] Failed to get count activities by guild:', err.message);
    return [];
  }
};

/**
 * Get counting activity by channel ID
 * @param {string} channelId 
 * @returns {Promise<Object|null>}
 */
const getCountActivityByChannel = async (channelId) => {
  if (!pool) return null;
  try {
    const dbPool = getPool();
    const [rows] = await dbPool.query('SELECT * FROM count_activities WHERE channel_id = ? AND is_active = TRUE LIMIT 1', [channelId]);
    return rows.length > 0 ? mapCountRow(rows[0]) : null;
  } catch (err) {
    console.error('[MySQL Error] Failed to get count activity by channel:', err.message);
    return null;
  }
};

/**
 * Find counting activity in guild by Activity ID, Name, or Channel ID
 * @param {string} guildId 
 * @param {string} target 
 * @returns {Promise<Object|null>}
 */
const findCountActivity = async (guildId, target) => {
  if (!pool || !target) return null;
  try {
    const dbPool = getPool();
    const cleanTarget = target.replace(/[<#>]/g, '').toLowerCase();
    const [rows] = await dbPool.query(
      `SELECT * FROM count_activities 
       WHERE guild_id = ? AND (LOWER(activity_id) = ? OR LOWER(name) = ? OR channel_id = ?)
       LIMIT 1`,
      [guildId, cleanTarget, cleanTarget, cleanTarget]
    );
    return rows.length > 0 ? mapCountRow(rows[0]) : null;
  } catch (err) {
    console.error('[MySQL Error] Failed to find count activity:', err.message);
    return null;
  }
};

/**
 * Save or update counting activity in MySQL
 * @param {Object} act 
 * @returns {Promise<Object>}
 */
const saveCountActivity = async (act) => {
  if (!pool) return act;
  try {
    const dbPool = getPool();
    await dbPool.query(
      `INSERT INTO count_activities (
        activity_id, guild_id, channel_id, name,
        current_number, last_user_id, last_bot_message_id, high_score,
        strict_mode, allow_consecutive, delete_consecutive,
        reaction_emoji, delete_chat, show_last, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        name = VALUES(name),
        channel_id = VALUES(channel_id),
        current_number = VALUES(current_number),
        last_user_id = VALUES(last_user_id),
        last_bot_message_id = VALUES(last_bot_message_id),
        high_score = VALUES(high_score),
        strict_mode = VALUES(strict_mode),
        allow_consecutive = VALUES(allow_consecutive),
        delete_consecutive = VALUES(delete_consecutive),
        reaction_emoji = VALUES(reaction_emoji),
        delete_chat = VALUES(delete_chat),
        show_last = VALUES(show_last),
        is_active = VALUES(is_active)`,
      [
        act.activityId,
        act.guildId,
        act.channelId,
        act.name,
        act.currentNumber || 0,
        act.lastUserId || null,
        act.lastBotMessageId || null,
        act.highScore || 0,
        act.strictMode ? 1 : 0,
        act.allowConsecutive ? 1 : 0,
        act.deleteConsecutive ? 1 : 0,
        act.reactionEmoji || '✅',
        act.deleteChat ? 1 : 0,
        act.showLast ? 1 : 0,
        act.isActive !== false ? 1 : 0
      ]
    );
    return act;
  } catch (err) {
    console.error('[MySQL Error] Failed to save count activity:', err.message);
    throw err;
  }
};

/**
 * Delete counting activity from MySQL
 * @param {string} activityId 
 * @returns {Promise<boolean>}
 */
const deleteCountActivity = async (activityId) => {
  if (!pool) return false;
  try {
    const dbPool = getPool();
    await dbPool.query('DELETE FROM count_activities WHERE activity_id = ?', [activityId]);
    return true;
  } catch (err) {
    console.error('[MySQL Error] Failed to delete count activity:', err.message);
    return false;
  }
};

module.exports = {
  initMySQL,
  logMessageActivity,
  getMessageCount,
  getGuildMessageCounts,
  pruneOldMessages,
  checkConnection,
  removeUserActivity,
  addLeftUser,
  removeLeftUser,
  getLeftUsers,
  wipeUserActivity,
  getAllActivityRoles,
  saveActivityRole,
  deleteActivityRole,
  getAllDmEnabledUsers,
  toggleDmEnabledUser,
  getAllCountActivities,
  getCountActivitiesByGuild,
  getCountActivityByChannel,
  findCountActivity,
  saveCountActivity,
  deleteCountActivity
};
