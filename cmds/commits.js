const { EmbedBuilder } = require('discord.js');
const { execSync } = require('child_process');

module.exports = {
  name: "commits",
  description: "Displays the last 5 commits made to the bot's GitHub repository.",
  usage: "commits",
  run: async (client, message, args, prefix, config) => {
    try {
      // Fetch the last 5 commits using git log
      const gitLog = execSync('git log -n 5 --pretty=format:"%h | %an (%ar): %s"').toString();
      
      const commits = gitLog.split('\n');

      if (!gitLog || commits.length === 0) {
        return message.reply('📭 No commit history found.');
      }

      const commitEmbed = new EmbedBuilder()
        .setColor('#F3F4F6')
        .setTitle('📜 Recent GitHub Commits')
        .setThumbnail(client.user.displayAvatarURL())
        .setTimestamp()
        .setFooter({ text: '🔄 Live from GitHub Main Branch' });

      commits.forEach(commit => {
        const [hash, details] = commit.split(' | ');
        commitEmbed.addFields({
          name: `📌 Commit: ${hash}`,
          value: details || 'No details provided.',
          inline: false
        });
      });

      return message.reply({ embeds: [commitEmbed] });
    } catch (error) {
      if (error.stderr?.toString().includes('fatal: your current branch appears to be broken') || 
          error.stderr?.toString().includes('fatal: index file corrupt')) {
        return message.reply('⚠️ **Git Repository Error**: Your local Git index or branch reference appears to be corrupted. The bot developer might need to repair the repository.');
      }
      
      console.error('Git Log Error:', error);
      return message.reply('❌ Failed to fetch commit history. Ensure Git is installed and initialized properly in this directory.');
    }
  }
};
