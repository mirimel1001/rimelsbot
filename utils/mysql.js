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
    console.log(`[MySQL Cleanup] Pruned ${result.affectedRows} messages older than ${days} days.`);

    const [leftResult] = await dbPool.query(
      'DELETE FROM left_users WHERE left_at < NOW() - INTERVAL ? DAY',
      [days]
    );
    console.log(`[MySQL Cleanup] Pruned ${leftResult.affectedRows} left users older than ${days} days.`);
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
    console.log(`[MySQL Cleanup] Removed activity messages for user ${userId} in guild ${guildId} (${result.affectedRows} rows).`);
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
    console.log(`[MySQL] Logged left user: ${username} (${userId}) in guild ${guildId}`);
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
    console.log(`[MySQL] Removed left user record for user ${userId} in guild ${guildId}`);
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

module.exports = {
  initMySQL,
  logMessageActivity,
  getMessageCount,
  pruneOldMessages,
  checkConnection,
  removeUserActivity,
  addLeftUser,
  removeLeftUser,
  getLeftUsers,
  wipeUserActivity
};
