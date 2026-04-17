module.exports = {
  name: "ping",
  run: async (client, message, args, prefix) => {
    return message.reply(`Pong! 🏓`);
  }
};
