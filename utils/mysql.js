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

module.exports = {
  initMySQL,
  logMessageActivity,
  getMessageCount,
  pruneOldMessages,
  checkConnection
};
