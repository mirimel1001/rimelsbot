const mongoose = require('mongoose');
const SyncRequest = require('../../models/SyncRequest');

// --- DATABASE SCHEMA ---
const PresenceSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true, index: true },
  username: { type: String, required: true },
  displayName: { type: String },
  avatarUrl: { type: String },
  status: { type: String, default: 'offline' }, // online, idle, dnd, offline
  activities: [{
    name: { type: String },
    state: { type: String },
    emoji: { type: String },
    type: { type: Number }
  }],
  roles: [{
    id: { type: String },
    name: { type: String },
    position: { type: Number }
  }]
}, { timestamps: true });

const Presence = mongoose.models.Presence || mongoose.model('Presence', PresenceSchema);

const https = require('https');

function fetchJson(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 4000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

const CURATED_GAME_METADATA = {
  'minecraft': {
    bannerUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/co49x5.jpg',
    genreTag: 'Survival / Sandbox'
  },
  'valorant': {
    bannerUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/co2mvt.jpg',
    genreTag: 'Tactical Shooter'
  },
  'league of legends': {
    bannerUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/co49wj.jpg',
    genreTag: 'MOBA Strategy'
  },
  'genshin impact': {
    bannerUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/co2040.jpg',
    genreTag: 'Action RPG / Open World'
  },
  'roblox': {
    bannerUrl: 'https://images.igdb.com/igdb/image/upload/t_1080p/co2k0z.jpg',
    genreTag: 'Community / Custom Games'
  },
  'counter-strike 2': {
    bannerUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/730/library_hero.jpg',
    genreTag: 'Competitive Tactical FPS'
  },
  'grand theft auto v': {
    bannerUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/271590/library_hero.jpg',
    genreTag: 'Open World Action'
  },
  'apex legends': {
    bannerUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/1172470/library_hero.jpg',
    genreTag: 'Battle Royale Hero Shooter'
  },
  'dota 2': {
    bannerUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/570/library_hero.jpg',
    genreTag: 'MOBA Strategy'
  },
  'cyberpunk 2077': {
    bannerUrl: 'https://cdn.akamai.steamstatic.com/steam/apps/1091500/library_hero.jpg',
    genreTag: 'Sci-Fi RPG'
  }
};

async function resolveGameMetadata(rawGameName) {
  if (!rawGameName) return { bannerUrl: null, genreTag: 'Community Game' };
  const cleanName = rawGameName.trim().toLowerCase();

  if (CURATED_GAME_METADATA[cleanName]) {
    return CURATED_GAME_METADATA[cleanName];
  }

  try {
    const steamUrl = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(rawGameName)}&l=english&cc=US`;
    const steamData = await fetchJson(steamUrl);
    if (steamData && steamData.items && steamData.items.length > 0) {
      const topMatch = steamData.items[0];
      const appId = topMatch.id;
      return {
        bannerUrl: `https://cdn.akamai.steamstatic.com/steam/apps/${appId}/library_hero.jpg`,
        genreTag: 'Steam Game'
      };
    }
  } catch (err) {}

  return {
    bannerUrl: null,
    genreTag: 'Gaming'
  };
}


const GameActivitySchema = new mongoose.Schema({
  gameName: { type: String, required: true, unique: true, index: true },
  bannerUrl: { type: String },
  genreTag: { type: String },
  lastPlayedAt: { type: Date, required: true, index: true },
  firstSeenAt: { type: Date, default: Date.now },
  totalSessions: { type: Number, default: 1 },
  uniquePlayersCount: { type: Number, default: 1 },
  uniquePlayerIds: [{ type: String }],
  recentPlayers: [{
    userId: { type: String },
    username: { type: String },
    displayName: { type: String },
    avatarUrl: { type: String },
    state: { type: String },
    lastSeen: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

const GameActivity = mongoose.models.GameActivity || mongoose.model('GameActivity', GameActivitySchema);

// Helper to record and prune 7-day game activity
const recordGameActivities = async (memberActivities, member) => {
  if (!memberActivities || memberActivities.length === 0) return;
  const now = new Date();
  
  for (const act of memberActivities) {
    if (act.type === 0 && act.name && act.name.trim() !== '') {
      const gameName = act.name.trim();
      const userId = String(member.id || member.userId);
      const username = member.user?.username || member.username;
      const displayName = member.displayName || member.user?.displayName || member.username;
      const avatarUrl = member.user ? member.user.displayAvatarURL({ dynamic: true, size: 256 }) : member.avatarUrl;

      const playerInfo = {
        userId,
        username,
        displayName,
        avatarUrl,
        state: act.state || '',
        lastSeen: now
      };

      try {
        const existing = await GameActivity.findOne({ gameName });
        if (existing) {
          const otherPlayers = (existing.recentPlayers || []).filter(p => p.userId !== userId);
          existing.recentPlayers = [playerInfo, ...otherPlayers].slice(0, 15);
          existing.lastPlayedAt = now;
          existing.totalSessions = (existing.totalSessions || 1) + 1;
          
          const playerSet = new Set(existing.uniquePlayerIds || []);
          playerSet.add(userId);
          existing.uniquePlayerIds = Array.from(playerSet);
          existing.uniquePlayersCount = existing.uniquePlayerIds.length;

          if (!existing.bannerUrl) {
            const meta = await resolveGameMetadata(gameName);
            if (meta.bannerUrl) existing.bannerUrl = meta.bannerUrl;
            if (meta.genreTag) existing.genreTag = meta.genreTag;
          }

          await existing.save();
        } else {
          const meta = await resolveGameMetadata(gameName);
          await GameActivity.create({
            gameName,
            bannerUrl: meta.bannerUrl || null,
            genreTag: meta.genreTag || 'Gaming',
            lastPlayedAt: now,
            firstSeenAt: now,
            totalSessions: 1,
            uniquePlayersCount: 1,
            uniquePlayerIds: [userId],
            recentPlayers: [playerInfo]
          });
        }
      } catch (err) {}
    }
  }
};

const pruneOldGameActivities = async () => {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const result = await GameActivity.deleteMany({ lastPlayedAt: { $lt: sevenDaysAgo } });
    if (result.deletedCount > 0) {
      console.log(`[GameActivity] Pruned ${result.deletedCount} games not played in the last 7 days.`);
    }
  } catch (err) {
    console.error('[GameActivity Prune Error]', err.message);
  }
};


// --- SYNC UTILITIES ---

const parseEmoji = (emoji) => {
  if (!emoji) return null;
  if (emoji.id) {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
  }
  return emoji.name || null;
};

const syncPresence = async (client, silent = false) => {
  try {
    const guildId = process.env.MAIN_GUILD_ID;
    if (!guildId) {
      if (!silent) console.warn('[WebSync] MAIN_GUILD_ID not defined in .env.');
      return;
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      if (!silent) console.warn(`[WebSync] Guild with ID ${guildId} not found in client cache.`);
      return;
    }

    // Read directly from cache to avoid any Gateway/REST API calls and rate limits.
    // The cache is kept complete and updated via GuildMembers/GuildPresences intents.
    const members = guild.members.cache;
    
    const bulkOps = [];
    members.forEach(member => {
      if (member.user.bot) return; // Skip bots

      const presence = member.presence;
      const roles = member.roles.cache
        .filter(role => role.name !== '@everyone')
        .map(role => ({ id: role.id, name: role.name, position: role.position }));

      const status = presence ? presence.status : 'offline';
      const activities = presence ? presence.activities.map(act => ({
        name: act.name,
        state: act.state || "",
        emoji: parseEmoji(act.emoji),
        type: act.type
      })) : [];
      const avatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 512 });
      recordGameActivities(activities, member);

      bulkOps.push({
        updateOne: {
          filter: { userId: member.id },
          update: {
            $set: {
              username: member.user.username,
              displayName: member.displayName,
              avatarUrl: avatarUrl,
              status: status,
              activities: activities,
              roles: roles
            }
          },
          upsert: true
        }
      });
    });

    await pruneOldGameActivities();
    if (bulkOps.length > 0) {
      await Presence.bulkWrite(bulkOps);
      if (!silent) console.log(`[WebSync] ${bulkOps.length} members synced from ${guild.name}`);
      return bulkOps.length;
    } else {
      if (!silent) console.log(`[WebSync] 0 members synced from ${guild.name}`);
      return 0;
    }
  } catch (error) {
    if (!silent) console.error('[WebSync Error] Failed to synchronize presences:', error);
    throw error;
  }
};

const updateSinglePresence = async (newPresence) => {
  try {
    if (!newPresence || !newPresence.user || newPresence.user.bot) return;
    const member = newPresence.member;
    if (!member) return;

    if (process.env.MAIN_GUILD_ID && newPresence.guild.id !== process.env.MAIN_GUILD_ID) return;

    const roles = member.roles.cache
      .filter(role => role.name !== '@everyone')
      .map(role => ({ id: role.id, name: role.name, position: role.position }));

    const avatarUrl = newPresence.user.displayAvatarURL({ dynamic: true, size: 512 });
    const activities = newPresence.activities.map(act => ({
      name: act.name,
      state: act.state || "",
      emoji: parseEmoji(act.emoji),
      type: act.type
    }));

    await Presence.findOneAndUpdate(
      { userId: newPresence.userId },
      {
        $set: {
          username: newPresence.user.username,
          displayName: member.displayName,
          avatarUrl: avatarUrl,
          status: newPresence.status,
          activities: activities,
          roles: roles
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    console.error('[WebSync Error] Failed to update single presence:', error);
  }
};

const updateSingleMember = async (oldMember, newMember) => {
  try {
    if (newMember.user.bot) return;
    if (process.env.MAIN_GUILD_ID && newMember.guild.id !== process.env.MAIN_GUILD_ID) return;

    const presence = newMember.presence;
    const status = presence ? presence.status : 'offline';
    const activities = presence ? presence.activities.map(act => ({
      name: act.name,
      state: act.state || "",
      emoji: parseEmoji(act.emoji),
      type: act.type
    })) : [];
    const roles = newMember.roles.cache
      .filter(role => role.name !== '@everyone')
      .map(role => ({ id: role.id, name: role.name, position: role.position }));

    const avatarUrl = newMember.user.displayAvatarURL({ dynamic: true, size: 512 });

    await Presence.findOneAndUpdate(
      { userId: newMember.id },
      {
        $set: {
          username: newMember.user.username,
          displayName: newMember.displayName,
          avatarUrl: avatarUrl,
          status: status,
          activities: activities,
          roles: roles
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
  } catch (error) {
    console.error('[WebSync Error] Failed to update member roles/nickname:', error);
  }
};

const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes global cooldown

const processSyncQueue = async (client) => {
  try {
    // Find the oldest pending request
    const pendingRequest = await SyncRequest.findOne({ status: 'pending' }).sort({ requestedAt: 1 });
    if (!pendingRequest) return;

    // Check if any request is currently processing
    const processingRequest = await SyncRequest.findOne({ status: 'processing' });
    if (processingRequest) {
      return;
    }

    // Check cooldown since the last processed sync
    const lastProcessed = await SyncRequest.findOne({ 
      status: { $in: ['completed', 'failed'] } 
    }).sort({ processedAt: -1 });

    if (lastProcessed && lastProcessed.processedAt) {
      const timeSinceLast = Date.now() - lastProcessed.processedAt.getTime();
      if (timeSinceLast < COOLDOWN_MS) {
        console.log(`[WebSync] Rejecting pending sync request (cooldown active: ${Math.round((COOLDOWN_MS - timeSinceLast)/1000)}s remaining)`);
        pendingRequest.status = 'failed';
        pendingRequest.error = 'Cooldown active';
        pendingRequest.processedAt = new Date();
        await pendingRequest.save();
        return;
      }
    }

    // Mark as processing
    pendingRequest.status = 'processing';
    await pendingRequest.save();

    console.log(`[WebSync] Processing sync request trigger...`);
    try {
      const count = await syncPresence(client);
      pendingRequest.status = 'completed';
      pendingRequest.processedAt = new Date();
      await pendingRequest.save();
      console.log(`[WebSync] Sync request completed successfully. Synced ${count} members.`);
    } catch (err) {
      pendingRequest.status = 'failed';
      pendingRequest.error = err.message || String(err);
      pendingRequest.processedAt = new Date();
      await pendingRequest.save();
      console.error(`[WebSync] Sync request failed:`, err);
    }
  } catch (error) {
    console.error('[WebSync Error] Error in processSyncQueue:', error);
  }
};

const handleMemberLeave = async (member) => {
  try {
    if (member.user.bot) return;
    if (process.env.MAIN_GUILD_ID && member.guild.id !== process.env.MAIN_GUILD_ID) return;

    await Presence.findOneAndUpdate(
      { userId: member.id },
      {
        $set: {
          status: 'left',
          activities: [],
          roles: []
        }
      },
      { upsert: true }
    );
    // console.log(`[WebSync] Marked leaving member ${member.user.tag} (${member.id}) as left in web database.`);
  } catch (error) {
    console.error('[WebSync Error] Failed to update single member status on leave:', error);
  }
};

const handleMemberJoin = async (member) => {
  try {
    if (member.user.bot) return;
    if (process.env.MAIN_GUILD_ID && member.guild.id !== process.env.MAIN_GUILD_ID) return;

    const presence = member.presence;
    const status = presence ? presence.status : 'offline';
    const activities = presence ? presence.activities.map(act => ({
      name: act.name,
      state: act.state || "",
      emoji: parseEmoji(act.emoji),
      type: act.type
    })) : [];
    const roles = member.roles.cache
      .filter(role => role.name !== '@everyone')
      .map(role => ({ id: role.id, name: role.name, position: role.position }));

    const avatarUrl = member.user.displayAvatarURL({ dynamic: true, size: 512 });

    await Presence.findOneAndUpdate(
      { userId: member.id },
      {
        $set: {
          username: member.user.username,
          displayName: member.displayName,
          avatarUrl: avatarUrl,
          status: status,
          activities: activities,
          roles: roles
        }
      },
      { upsert: true, returnDocument: 'after' }
    );
    // console.log(`[WebSync] Member joined and presence synced: ${member.user.tag}`);
  } catch (error) {
    console.error('[WebSync Error] Failed to handle member join:', error);
  }
};

// --- COMMAND DEFINITION ---
module.exports = {
  name: 'websync',
  aliases: ['ws'],
  description: 'Synchronizes member status, activities, and roles to the web database.',
  run: async (client, message, args, prefix, config) => {
    // Restrict command to bot owner
    if (!client.owners.has(message.author.id)) {
      return message.reply('❌ Only the bot owner can use this command.');
    }

    const statusMsg = await message.reply('⏳ Syncing member data to database...');
    try {
      const count = await syncPresence(client);
      await statusMsg.edit(`✅ Successfully synchronized status & roles of **${count}** members.`);
    } catch (err) {
      await statusMsg.edit(`❌ Sync failed: \`${err.message}\``);
    }
  },
  // Export sync utilities for index.js
  syncPresence,
  updateSinglePresence,
  updateSingleMember,
  handleMemberLeave,
  handleMemberJoin,
  processSyncQueue
};

