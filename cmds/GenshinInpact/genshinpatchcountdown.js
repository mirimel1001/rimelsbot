const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const cheerio = require('cheerio');
const sharp = require('sharp');

module.exports = {
  name: "genshinpatchcountdown",
  description: "Get the countdown for the upcoming Genshin Impact patch/banner.",
  aliases: ["gpc"],
  usage: "genshinpatchcountdown",
  run: async (client, message, args, prefix) => {
    const loadingMsg = await message.reply("Scraping data and preparing banner... ⏳");

    try {
      const url = 'https://genshin-countdown.gengamer.in/';
      const { data } = await axios.get(url);
      const $ = cheerio.load(data);

      const title = $('h1').text().trim() || "Genshin Impact Banner Countdown";
      const subtitle = $('h2').text().trim() || "Upcoming Characters";
      
      const imageUrls = [];
      $('.psImg img').each((i, el) => {
        let src = $(el).attr('src');
        if (src) {
          if (src.startsWith('/')) src = new URL(src, url).href;
          imageUrls.push(src);
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
      
      const unixTimestamp = Math.floor(releaseDate.getTime() / 1000);
      const liveCountdown = `<t:${unixTimestamp}:R>`;
      const absoluteTimeStr = `<t:${unixTimestamp}:F>`;
      
      const mainEmbed = new EmbedBuilder()
        .setTitle(title)
        .setURL(url)
        .setDescription(`**${subtitle}**\n\n**Countdown:** ${liveCountdown}\n**Release Date:** ${absoluteTimeStr}`)
        .setColor('#00ffcc')
        .setFooter({ text: "Data from genshin-countdown.gengamer.in", iconURL: client.user.displayAvatarURL() })
        .setTimestamp();

      const files = [];

      if (imageUrls.length > 0) {
        try {
          // Download images
          const imageBuffers = await Promise.all(imageUrls.map(async (imgUrl) => {
            const response = await axios.get(imgUrl, { responseType: 'arraybuffer' });
            return Buffer.from(response.data);
          }));

          // Get metadata
          const metadatas = await Promise.all(imageBuffers.map(buf => sharp(buf).metadata()));
          
          const maxWidth = Math.max(...metadatas.map(m => m.width));
          const totalHeight = metadatas.reduce((sum, m) => sum + m.height, 0) + 15; // 15px gap

          // Stitch
          let currentY = 0;
          const compositeOps = imageBuffers.map((buf, i) => {
            const op = {
              input: buf,
              top: currentY,
              left: Math.round((maxWidth - metadatas[i].width) / 2)
            };
            currentY += metadatas[i].height + 15;
            return op;
          });

          const stitchedBuffer = await sharp({
            create: {
                width: maxWidth,
                height: totalHeight,
                channels: 4,
                background: { r: 0, g: 0, b: 0, alpha: 0 }
            }
          })
          .composite(compositeOps)
          .png()
          .toBuffer();

          const attachment = new AttachmentBuilder(stitchedBuffer, { name: 'banner.png' });
          files.push(attachment);
          mainEmbed.setImage('attachment://banner.png');
        } catch (imgError) {
          console.error("Image processing error:", imgError);
          // Fallback to first image URL if processing fails
          mainEmbed.setImage(imageUrls[0]);
        }
      }

      await loadingMsg.edit({ content: null, embeds: [mainEmbed], files: files });

    } catch (error) {
      console.error('Genshin Countdown Error:', error);
      loadingMsg.edit("❌ An error occurred while fetching the countdown data.");
    }
  }
};
