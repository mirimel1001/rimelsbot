module.exports = {
  name: "ping",
  run: async (client, message, args, prefix) => {
    const msg = await message.reply("Pinging... 🏓");
    const ping = msg.createdTimestamp - message.createdTimestamp;

    return msg.edit(`Pong! 🏓\n**Bot Latency:** \`${ping}ms\`\n**API Latency:** \`${Math.round(client.ws.ping)}ms\``);
  }
};
