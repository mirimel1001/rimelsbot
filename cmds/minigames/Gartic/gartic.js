const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const Jimp = require('jimp');
const fs = require('fs');
const axios = require('axios');

module.exports = {
  name: "gartic",
  aliases: ["guess"],
  description: "Guess the hidden image as it reveals itself!",
  usage: "gartic",
  run: async (client, message, args, prefix, config) => {
    // 1. Check if a game is already running in this channel
    if (client.garticGames?.has(message.channel.id)) {
      return message.reply("⚠️ A Gartic game is already running in this channel!");
    }

    if (!client.garticGames) client.garticGames = new Set();
    client.garticGames.add(message.channel.id);

    try {
      let secretWord = "";
      let imageSource = null; // Buffer or Path
      const isApiGame = !!process.env.PIXABAY_KEY;

      // 2. Load Word/Image
      if (isApiGame) {
        try {
          const categories = ['animals', 'nature', 'food', 'transportation', 'places'];
          const category = categories[Math.floor(Math.random() * categories.length)];
          
          const response = await axios.get('https://pixabay.com/api/', {
            params: {
              key: process.env.PIXABAY_KEY,
              q: category,
              image_type: 'photo',
              safesearch: true,
              per_page: 50
            }
          });

          const hits = response.data.hits.filter(h => h.tags.split(',')[0].length > 3);
          const selection = hits[Math.floor(Math.random() * hits.length)];
          
          // Get the most descriptive tag (longest of the first 2 usually)
          const tags = selection.tags.split(',').map(t => t.trim());
          secretWord = tags[0].toLowerCase();
          
          // Fetch the image buffer
          const imgUrl = selection.webformatURL;
          const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
          imageSource = Buffer.from(imgRes.data);
          
          console.log(`[Gartic] API Selection: ${secretWord} (Category: ${category})`);
        } catch (apiErr) {
          console.error('[Gartic] Pixabay API Error, falling back:', apiErr.message);
        }
      }

      // Fallback if API failed or not configured
      if (!secretWord || !imageSource) {
        const words = JSON.parse(fs.readFileSync('./gartic_words.json', 'utf8'));
        const selection = words[Math.floor(Math.random() * words.length)];
        secretWord = selection.word.toLowerCase();
        imageSource = selection.path;
      }

      // 3. Game Config
      const levels = [50, 20, 1]; // Pixelation sizes
      const prize = 500;
      let gameWon = false;

      const mainEmbed = new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle('🎨 Gartic: Guess the Image!')
        .setDescription(`Using **${isApiGame ? 'Dynamic AI' : 'Classic Starter'}** images!\nBe the first to type the correct word in chat.\nPrize: **💰 ${prize} Cash**`)
        .setFooter({ text: 'Game starts in 3 seconds...' });

      const gameMsg = await message.channel.send({ embeds: [mainEmbed] });
      await new Promise(r => setTimeout(r, 3000));

      // 4. Collector for guesses
      const filter = (m) => !m.author.bot;
      const collector = message.channel.createMessageCollector({ filter, time: 60000 });

      collector.on('collect', async (m) => {
        if (m.content.toLowerCase() === secretWord) {
          gameWon = true;
          collector.stop('won');

          try {
            await axios.patch(`https://unbelievaboat.com/api/v1/guilds/${message.guild.id}/users/${m.author.id}`, {
              cash: prize
            }, {
              headers: { 'Authorization': process.env.UNB_TOKEN }
            });

            const winEmbed = new EmbedBuilder()
              .setColor('#2ECC71')
              .setTitle('🎉 WE HAVE A WINNER!')
              .setDescription(`Congratulations **${m.author.username}**! You guessed **${secretWord.toUpperCase()}** correctly.`)
              .addFields({ name: 'Reward', value: `💰 ${prize} Cash added to your balance!` })
              .setImage('attachment://final.png');

            const finalImage = await Jimp.read(imageSource);
            const buffer = await finalImage.getBufferAsync(Jimp.MIME_PNG);
            const attachment = new AttachmentBuilder(buffer, { name: 'final.png' });

            await m.reply({ embeds: [winEmbed], files: [attachment] });
          } catch (err) {
            console.error('Gartic Prize Error:', err.message);
            m.reply(`🎉 You won! The word was **${secretWord}**, but I couldn't update your balance automatically.`);
          }
        }
      });

      // 5. Reveal Stages
      for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
        if (gameWon) break;

        const pixelSize = levels[levelIdx];
        const image = await Jimp.read(imageSource);
        if (pixelSize > 1) image.pixelate(pixelSize);
        const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
        const attachment = new AttachmentBuilder(buffer, { name: `reveal_${levelIdx}.png` });

        const revealEmbed = new EmbedBuilder()
          .setColor('#F1C40F')
          .setTitle(`🎨 Gartic: Reveal Stage ${levelIdx + 1}/3`)
          .setDescription(`Type your guesses in chat now!\nHint: The word has **${secretWord.length}** letters.`)
          .setImage(`attachment://reveal_${levelIdx}.png`);

        await gameMsg.edit({ embeds: [revealEmbed], files: [attachment] }).catch(() => {});

        await new Promise(r => {
          let timer = setTimeout(r, 15000);
          const check = setInterval(() => { if (gameWon) { clearTimeout(timer); clearInterval(check); r(); } }, 500);
        });
      }

      collector.on('end', (collected, reason) => {
        client.garticGames.delete(message.channel.id);
        if (reason !== 'won' && !gameWon) {
          gameMsg.reply(`🔌 Time's up! Nobody guessed it. The word was **${secretWord.toUpperCase()}**.`);
        }
      });

    } catch (error) {
      console.error('Gartic Game Error:', error);
      client.garticGames?.delete(message.channel.id);
      return message.reply("❌ System Error: Could not start the Gartic game.");
    }
  }
};
