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

// --- SYNC UTILITIES ---

const parseEmoji = (emoji) => {
  if (!emoji) return null;
  if (emoji.id) {
    return `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}`;
  }
  return emoji.name || null;
};

const syncPresence = async (client) => {
  try {
    const guildId = process.env.MAIN_GUILD_ID;
    if (!guildId) {
      console.warn('[WebSync] MAIN_GUILD_ID not defined in .env.');
      return;
    }
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      console.warn(`[WebSync] Guild with ID ${guildId} not found in client cache.`);
      return;
    }

    // Fetch all members with their presences
    const members = await guild.members.fetch({ withPresences: true });
    
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

    if (bulkOps.length > 0) {
      await Presence.bulkWrite(bulkOps);
      console.log(`[WebSync] ${bulkOps.length} members synced from ${guild.name}`);
      return bulkOps.length;
    } else {
      console.log(`[WebSync] 0 members synced from ${guild.name}`);
      return 0;
    }
  } catch (error) {
    console.error('[WebSync Error] Failed to synchronize presences:', error);
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
  processSyncQueue
};

