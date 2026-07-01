const fs = require('fs');

module.exports = {
  name: "highlowping",
  aliases: ["hlp"],
  category: "Games",
  description: "Toggle the cooldown reminder for HighLow. If on, you'll be pinged when you can play again.",
  usage: "highlowping",
  run: async (client, message, args, prefix, config) => {
    // 1. Load Settings from MongoDB Cache
    const Guild = require('../../../models/Guild');
    const currentCache = client.gameSettings.get(message.guild.id) || {};
    
    if (!currentCache.reminders) currentCache.reminders = {};
    if (!currentCache.reminders[message.author.id]) currentCache.reminders[message.author.id] = {};

    const currentStatus = currentCache.reminders[message.author.id].highlow || false;
    const statusText = currentStatus ? "✅ **ON**" : "❌ **OFF**";

    const promptMsg = await message.reply(`🔔 **HighLow Reminder Status:** ${statusText}\nDo you want to change it? Type **yes** or **no**.`);

    const filter = m => m.author.id === message.author.id && ['yes', 'no', 'y', 'n'].includes(m.content.toLowerCase());
    const collector = message.channel.createMessageCollector({ filter, time: 20000, max: 1 });

    collector.on('collect', async m => {
      const input = m.content.toLowerCase();
      if (input === 'yes' || input === 'y') {
        const newStatus = !currentStatus;
        
        if (!currentCache.reminders) currentCache.reminders = {};
        if (!currentCache.reminders[message.author.id]) currentCache.reminders[message.author.id] = {};
        currentCache.reminders[message.author.id].highlow = newStatus;
        
        try {
          await Guild.findOneAndUpdate(
            { guildId: message.guild.id },
            { gameSettings: currentCache },
            { upsert: true }
          );
          client.gameSettings.set(message.guild.id, currentCache);
          
          const resultText = newStatus ? "✅ **ON**" : "❌ **OFF**";
          message.reply(`🔄 **Updated!** Your HighLow reminder is now ${resultText}.`);
        } catch (err) {
          console.error('Error saving settings:', err.message);
          message.reply("❌ Failed to save setting.");
        }
      } else {
        message.reply("👌 **Cancelled.** Status remains unchanged.");
      }
    });

    collector.on('end', collected => {
      if (collected.size === 0) {
        promptMsg.edit({ content: `⏰ **Timed out.** Reminder status is still ${statusText}.` }).catch(() => {});
      }
    });
  }
};
