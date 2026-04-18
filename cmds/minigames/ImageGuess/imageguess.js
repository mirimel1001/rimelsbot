const { EmbedBuilder, AttachmentBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } = require('discord.js');
const Jimp = require('jimp');
const fs = require('fs');
const axios = require('axios');

module.exports = {
  name: "imageguess",
  aliases: ["ig"],
  category: "minigame",
  description: "Guess the hidden image as it reveals itself! Pick a category and win cash.",
  usage: "imageguess",
  run: async (client, message, args, prefix, config) => {
    // 1. Check if a game is already running
    if (!client.imageGuessGames) client.imageGuessGames = new Set();
    if (client.imageGuessGames.has(message.channel.id)) {
      return message.reply("⚠️ An ImageGuess game is already running in this channel!");
    }

    client.imageGuessGames.add(message.channel.id);

    try {
      // --- COOLDOWN CHECK ---
      if (fs.existsSync('./server_game_settings.json')) {
        const settings = JSON.parse(fs.readFileSync('./server_game_settings.json', 'utf8'));
        const delay = settings.guilds[message.guild.id]?.delays?.imageguess || settings.defaults?.delays?.imageguess;

        if (delay) {
          const key = `${message.guild.id}-imageguess-${message.author.id}`;
          const lastPlay = client.cooldowns.get(key);
          const now = Date.now();

          if (lastPlay && now < lastPlay + delay) {
            const timeLeft = ((lastPlay + delay - now) / 1000).toFixed(1);
            return message.reply(`⏳ Slow down! You can play **ImageGuess** again in **${timeLeft}s**.`);
          }
          client.cooldowns.set(key, now);
        }
      }

      const apiKey = process.env.PIXABAY_KEY;
      const isApiGame = !!apiKey;

      // 2. Category Selection (If API is available)
      let selectedCategory = 'random';
      if (isApiGame) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('animals').setLabel('🦁 Animals').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('nature').setLabel('🌲 Nature').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('food').setLabel('🍕 Food').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('places').setLabel('🌆 Cities').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('random').setLabel('🎲 Random').setStyle(ButtonStyle.Secondary)
        );

        const selectionEmbed = new EmbedBuilder()
          .setColor('#5865F2')
          .setTitle('🖼️ ImageGuess: Pick a Category')
          .setDescription('Click a button below to choose the theme for this game!')
          .setFooter({ text: 'Selection expires in 30 seconds' });

        const selectionMsg = await message.reply({ embeds: [selectionEmbed], components: [row] });

        const selectionCollector = selectionMsg.createMessageComponentCollector({ 
          componentType: ComponentType.Button, 
          time: 30000,
          filter: (i) => i.user.id === message.author.id 
        });

        await new Promise((resolve) => {
          selectionCollector.on('collect', (i) => {
            selectedCategory = i.customId;
            i.update({ content: `✅ Category selected: **${selectedCategory.toUpperCase()}**`, embeds: [], components: [] });
            resolve(true);
          });
          selectionCollector.on('end', (collected) => {
            if (collected.size === 0) {
              selectionMsg.edit({ content: '⏰ No category selected, choosing **RANDOM**...', embeds: [], components: [] });
              resolve(false);
            }
          });
        });
      }

      // 3. Load Word/Image
      let secretWord = "";
      let imageSource = null;

      if (isApiGame) {
        try {
          const categories = ['animals', 'nature', 'food', 'transportation', 'places'];
          let query = selectedCategory === 'random' ? categories[Math.floor(Math.random() * categories.length)] : selectedCategory;
          
          const response = await axios.get('https://pixabay.com/api/', {
            params: {
              key: apiKey,
              q: query,
              image_type: 'photo',
              safesearch: true,
              per_page: 50
            }
          });

          const hits = response.data.hits.filter(h => h.tags.split(',')[0].length > 3);
          const selection = hits[Math.floor(Math.random() * hits.length)];
          
          const tags = selection.tags.split(',').map(t => t.trim());
          secretWord = tags[0].toLowerCase();
          
          const imgUrl = selection.webformatURL;
          const imgRes = await axios.get(imgUrl, { responseType: 'arraybuffer' });
          imageSource = Buffer.from(imgRes.data);
          
          console.log(`[ImageGuess] Selection: ${secretWord} (Category: ${query})`);
        } catch (apiErr) {
          console.error('[ImageGuess] API Error, falling back:', apiErr.message);
        }
      }

      // Fallback
      if (!secretWord || !imageSource) {
        const words = JSON.parse(fs.readFileSync('./gartic_words.json', 'utf8'));
        const selection = words[Math.floor(Math.random() * words.length)];
        secretWord = selection.word.toLowerCase();
        imageSource = selection.path;
      }

      // 4. Game Start
      let prize = Math.floor(Math.random() * (600 - 300 + 1)) + 300; 
      try {
        if (fs.existsSync('./server_prize_configs.json')) {
          const prizeData = JSON.parse(fs.readFileSync('./server_prize_configs.json', 'utf8'));
          const guildPrizes = prizeData.guilds[message.guild.id]?.imageguess;
          if (guildPrizes) {
            prize = Math.floor(Math.random() * (guildPrizes.max - guildPrizes.min + 1)) + guildPrizes.min;
          }
        }
      } catch (err) {
        console.error('Error loading prize range:', err.message);
      }

      const levels = [50, 20, 1];
      let gameWon = false;

      const mainEmbed = new EmbedBuilder()
        .setColor('#F1C40F')
        .setTitle('🎨 ImageGuess: Guess the Photo!')
        .setDescription(`Be the first to type the correct word in chat.\nPrize: **💰 ${prize} Cash**`)
        .setFooter({ text: 'Game starts in 3 seconds...' });

      const gameMsg = await message.channel.send({ embeds: [mainEmbed] });
      await new Promise(r => setTimeout(r, 3000));

      const guessFilter = (m) => !m.author.bot;
      const guessCollector = message.channel.createMessageCollector({ filter: guessFilter, time: 60000 });

      guessCollector.on('collect', async (m) => {
        if (m.content.toLowerCase() === secretWord) {
          gameWon = true;
          guessCollector.stop('won');

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
            console.error('ImageGuess Prize Error:', err.message);
            m.reply(`🎉 You won! The word was **${secretWord}**, but I couldn't update your balance automatically.`);
          }
        }
      });

      guessCollector.on('end', (collected, reason) => {
        if (reason !== 'won' && !gameWon) {
          gameMsg.reply(`🔌 Time's up! Nobody guessed it. The word was **${secretWord.toUpperCase()}**.`);
        }
      });

      for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
        if (gameWon) break;

        const pixelSize = levels[levelIdx];
        const image = await Jimp.read(imageSource);
        if (pixelSize > 1) image.pixelate(pixelSize);
        const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
        const attachment = new AttachmentBuilder(buffer, { name: `reveal_${levelIdx}.png` });

        const revealEmbed = new EmbedBuilder()
          .setColor('#F1C40F')
          .setTitle(`🎨 ImageGuess: Reveal Stage ${levelIdx + 1}/3`)
          .setDescription(`Type your guesses in chat now!\nHint: The word has **${secretWord.length}** letters.\nCategory: **${selectedCategory.toUpperCase()}**`)
          .setImage(`attachment://reveal_${levelIdx}.png`);

        await gameMsg.edit({ embeds: [revealEmbed], files: [attachment] }).catch(() => {});

        await new Promise(r => {
          let timer = setTimeout(r, 15000);
          const check = setInterval(() => { 
            if (gameWon) { 
              clearTimeout(timer); 
              clearInterval(check); 
              r(); 
            } 
          }, 500);
        });
      }

    } catch (error) {
      console.error('ImageGuess Game Error:', error);
      return message.reply("❌ System Error: Could not finish the game.");
    } finally {
      // ALWAYS cleanup
      client.imageGuessGames.delete(message.channel.id);
    }
  }
};
