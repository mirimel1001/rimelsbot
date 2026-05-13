const { EmbedBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');

module.exports = {
  name: "genshinpatchcountdown",
  description: "Get the countdown for the upcoming Genshin Impact patch/banner.",
  aliases: ["gpc"],
  usage: "genshinpatchcountdown",
  run: async (client, message, args, prefix) => {
    const loadingMsg = await message.reply("Scraping data from Genshin Countdown... ⏳");

    try {
      const url = 'https://genshin-countdown.gengamer.in/';
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);

      const title = $('h1').text().trim() || "Genshin Impact Banner Countdown";
      const subtitle = $('h2').text().trim() || "Upcoming Characters";
      
      const images = [];
      $('.psImg img').each((i, el) => {
        let src = $(el).attr('src');
        if (src) {
          // Ensure absolute URL
          if (src.startsWith('/')) src = new URL(src, url).href;
          images.push(src);
        }
      });

      // Extract date from script
      const scriptContent = $('script').map((i, el) => $(el).html()).get().join('\n');
      const dateMatch = scriptContent.match(/new Date\(['"]([^'"]+)['"]\)/);
      const releaseDateStr = dateMatch ? dateMatch[1] : null;

      if (!releaseDateStr) {
        return loadingMsg.edit("❌ Could not find the release date on the website.");
      }

      const releaseDate = new Date(releaseDateStr);
      const now = new Date();
      const diff = releaseDate - now;

      if (diff <= 0) {
        const releasedEmbed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(`✅ **${subtitle}** has already been released!`)
          .setColor('#00ffcc')
          .setTimestamp();
        return loadingMsg.edit({ content: null, embeds: [releasedEmbed] });
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const countdownStr = `\`${days}\` Days \`${hours}\` Hours \`${minutes}\` Minutes \`${seconds}\` Seconds`;
      
      const mainEmbed = new EmbedBuilder()
        .setTitle(title)
        .setURL(url)
        .setDescription(`**${subtitle}**\n\n**Countdown:**\n${countdownStr}\n\n**Release Date:** \`${releaseDate.toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}\``)
        .setColor('#00ffcc')
        .setFooter({ text: "Data from genshin-countdown.gengamer.in", iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const embeds = [mainEmbed];

      if (images.length > 0) {
        mainEmbed.setImage(images[0]);
        
        // Add second image as a separate embed linked to the first
        if (images.length > 1) {
          const secondEmbed = new EmbedBuilder()
            .setURL(url)
            .setImage(images[1]);
          embeds.push(secondEmbed);
        }
      }

      await loadingMsg.edit({ content: null, embeds: embeds });

    } catch (error) {
      console.error('Genshin Countdown Error:', error);
      loadingMsg.edit("❌ An error occurred while fetching the countdown data.");
    }
  }
};
