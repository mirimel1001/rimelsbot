const fs = require('fs');

module.exports = {
  name: "highlowping",
  aliases: ["hlp"],
  category: "Games",
  description: "Toggle the cooldown reminder for HighLow. If on, you'll be pinged when you can play again.",
  usage: "highlowping [on/off]",
  run: async (client, message, args, prefix, config) => {
    let choice = args[0]?.toLowerCase();
    
    // 1. Load Settings
    const filePath = './server_game_settings.json';
    let data = { guilds: {} };
    
    try {
      if (fs.existsSync(filePath)) {
        data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading server_game_settings.json:', err.message);
      return message.reply("❌ Error loading settings.");
    }

    if (!data.guilds[message.guild.id]) data.guilds[message.guild.id] = {};
    if (!data.guilds[message.guild.id].reminders) data.guilds[message.guild.id].reminders = {};
    if (!data.guilds[message.guild.id].reminders[message.author.id]) data.guilds[message.guild.id].reminders[message.author.id] = {};

    const currentStatus = data.guilds[message.guild.id].reminders[message.author.id].highlow || false;

    // 2. Determine action
    if (!choice) {
      // Toggle if no arg provided
      choice = currentStatus ? 'off' : 'on';
    }

    if (choice === 'on') {
      data.guilds[message.guild.id].reminders[message.author.id].highlow = true;
      message.reply("✅ **HighLow Reminder:** ON. I will ping you when your cooldown expires!");
    } else if (choice === 'off') {
      data.guilds[message.guild.id].reminders[message.author.id].highlow = false;
      message.reply("❌ **HighLow Reminder:** OFF. You will no longer receive cooldown pings.");
    } else {
      return message.reply(`❌ Invalid choice! Use \`${prefix}hlp on\` or \`${prefix}hlp off\`.`);
    }

    // 3. Save
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (err) {
      console.error('Error saving server_game_settings.json:', err.message);
      return message.reply("❌ Error saving settings.");
    }
  }
};
