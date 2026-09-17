const { getCountActivityByChannel, saveCountActivity } = require('./mysql.js');

// In-memory mutex/queue to prevent race conditions on rapid counting
const channelLocks = new Map();

// Cooldown map to prevent warning spam: key = "channelId-userId", value = timestamp
const warningCooldowns = new Map();

/**
 * Handle count messages in a counting channel
 * @returns {Promise<boolean>} True if the message was handled by the counting engine
 */
const handleCountMessage = async (client, message) => {
  if (!message.guild || !message.channel || message.author.bot) return false;

  // Retrieve activity from client cache or MySQL
  let activity = client.countActivities ? client.countActivities.get(message.channel.id) : null;
  if (!activity) {
    try {
      activity = await getCountActivityByChannel(message.channel.id);
      if (activity && client.countActivities) {
        client.countActivities.set(message.channel.id, activity);
      }
    } catch (err) {
      console.error('[Count Engine Fetch Error]', err);
      return false;
    }
  }

  if (!activity || !activity.isActive) return false;

  // Queue sequential execution for this channel
  const previousLock = channelLocks.get(message.channel.id) || Promise.resolve();

  const currentTask = previousLock.then(async () => {
    try {
      const rawText = message.content.trim();

      // Check if message is wrapped or prefixed/suffixed with parentheses, brackets, braces, or starts with double slash (Chat Bypass)
      // e.g. (chat), (chat, chat), [chat], {chat}, // chat
      const isBracketedChat = (
        rawText.startsWith('(') || rawText.endsWith(')') ||
        rawText.startsWith('[') || rawText.endsWith(']') ||
        rawText.startsWith('{') || rawText.endsWith('}') ||
        rawText.startsWith('//')
      );

      if (isBracketedChat) {
        // Allowed as chat bypass; ignore from counting engine and do not delete
        return false;
      }

      // Check if message is a valid integer count (accepts pure digits, handles commas like 1,000)
      const sanitizedText = rawText.replace(/,/g, '');
      const isPureNumber = /^-?\d+$/.test(sanitizedText);

      if (!isPureNumber) {
        // Not a count number
        if (activity.deleteChat) {
          // Purge standard conversation
          await message.delete().catch(() => {});

          // Send throttled self-deleting warning (1 warning per user every 8 seconds)
          const warnKey = `chat-${message.channel.id}-${message.author.id}`;
          const lastWarn = warningCooldowns.get(warnKey) || 0;
          const now = Date.now();

          if (now - lastWarn > 8000) {
            warningCooldowns.set(warnKey, now);
            const warnMsg = await message.channel.send(
              `⚠️ ${message.author}, this channel is for counting only! Use brackets like \`(your message)\` to talk without getting deleted.\n-# *This message will self destruct in 30 seconds*`
            ).catch(() => null);

            if (warnMsg) {
              setTimeout(() => {
                warnMsg.delete().catch(() => {});
              }, 30000);
            }
          }

          return true;
        }
        // If deleteChat is false, allow normal conversation
        return false;
      }

      const inputNumber = parseInt(sanitizedText, 10);
      const expectedNumber = activity.currentNumber + 1;

      // 1. Consecutive Message Check
      if (!activity.allowConsecutive && activity.lastUserId === message.author.id) {
        if (activity.deleteConsecutive) {
          await message.delete().catch(() => {});
        } else {
          await message.react('❌').catch(() => {});
        }

        // Send throttled self-deleting warning
        const warnKey = `cm-${message.channel.id}-${message.author.id}`;
        const lastWarn = warningCooldowns.get(warnKey) || 0;
        const now = Date.now();

        if (now - lastWarn > 8000) {
          warningCooldowns.set(warnKey, now);
          const warnMsg = await message.channel.send(
            `⚠️ ${message.author} we do counting together 😠\n-# *This message will self destruct in 30 seconds*`
          ).catch(() => null);

          if (warnMsg) {
            setTimeout(() => {
              warnMsg.delete().catch(() => {});
            }, 30000);
          }
        }
        return true;
      }

      // 2. Incorrect Number Check
      if (inputNumber !== expectedNumber) {
        if (activity.strictMode) {
          // Strict Mode: Reset counter to 0
          const ruinedCount = activity.currentNumber;
          activity.currentNumber = 0;
          activity.lastUserId = null;
          await saveCountActivity(activity);

          if (client.countActivities) {
            client.countActivities.set(activity.channelId, activity);
          }

          await message.react('💥').catch(() => {});
          await message.channel.send(`❌ ${message.author} not the right number bud 😅 You ruined the count at **${ruinedCount}**! The count has been reset back to **0** (Next expected: **1**).`).catch(() => {});
          return true;
        } else {
          // Non-Strict Mode: Delete wrong number or react ❌
          await message.delete().catch(() => {
            message.react('❌').catch(() => {});
          });

          // Throttled self-deleting warning
          const warnKey = `num-${message.channel.id}-${message.author.id}`;
          const lastWarn = warningCooldowns.get(warnKey) || 0;
          const now = Date.now();

          if (now - lastWarn > 6000) {
            warningCooldowns.set(warnKey, now);
            const warnMsg = await message.channel.send(
              `⚠️ ${message.author} not the right number bud 😅 Next expected count is **${expectedNumber}**.\n-# *This message will self destruct in 30 seconds*`
            ).catch(() => null);

            if (warnMsg) {
              setTimeout(() => {
                warnMsg.delete().catch(() => {});
              }, 30000);
            }
          }
          return true;
        }
      }

      // 3. Correct Count
      activity.currentNumber = inputNumber;
      activity.lastUserId = message.author.id;
      if (inputNumber > activity.highScore) {
        activity.highScore = inputNumber;
      }

      // React with confirmation emoji
      await message.react(activity.reactionEmoji || '✅').catch(() => {});

      await saveCountActivity(activity);
      if (client.countActivities) {
        client.countActivities.set(activity.channelId, activity);
      }

      return true;
    } catch (err) {
      console.error('[Count Engine Message Processing Error]', err);
      return false;
    }
  });

  channelLocks.set(message.channel.id, currentTask.catch(() => {}));
  return await currentTask;
};

module.exports = {
  handleCountMessage
};
