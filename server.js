import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import { TwitterApi } from "twitter-api-v2";

dotenv.config();


const app = express();
app.use(express.json());

// Configuration
const config = {
  github: {
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    token: process.env.GITHUB_TOKEN
  },
  twitter: {
    appKey: process.env.TWITTER_API_KEY,
    appSecret: process.env.TWITTER_API_SECRET,
    accessToken: process.env.TWITTER_ACCESS_TOKEN,
    accessSecret: process.env.TWITTER_ACCESS_SECRET
  },
  port: process.env.PORT || 3000
};

// Initialize Twitter client
const twitterClient = new TwitterApi({
  appKey: config.twitter.appKey,
  appSecret: config.twitter.appSecret,
  accessToken: config.twitter.accessToken,
  accessSecret: config.twitter.accessSecret,
});

// Verify GitHub webhook signature
function verifyGitHubSignature(payload, signature) {
  const expectedSignature = crypto
    .createHmac('sha256', config.github.webhookSecret)
    .update(payload, 'utf8')
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(`sha256=${expectedSignature}`, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}

// Analyze commit and generate tweet content
function analyzeCommit(commit) {
  const { message, author, added, modified, removed } = commit;
  
  // Extract key information
  const changedFiles = added.length + modified.length + removed.length;
  const additions = commit.stats?.additions || 0;
  const deletions = commit.stats?.deletions || 0;
  
  // Generate tweet based on commit analysis
  let tweetContent = '';
  
  // Detect commit type based on message
  const commitType = detectCommitType(message);
  
  switch (commitType) {
    case 'feature':
      tweetContent = `🚀 New feature added! ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;
      break;
    case 'fix':
      tweetContent = `🐛 Bug fix deployed: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;
      break;
    case 'docs':
      tweetContent = `📝 Documentation updated: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;
      break;
    case 'refactor':
      tweetContent = `♻️ Code refactored: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;
      break;
    default:
      tweetContent = `💻 Code update: ${message.substring(0, 100)}${message.length > 100 ? '...' : ''}`;
  }
  
  // Add stats if significant changes
  if (changedFiles > 5 || additions > 50) {
    tweetContent += `\n\n📊 ${changedFiles} files changed`;
    if (additions > 0) tweetContent += ` (+${additions})`;
    if (deletions > 0) tweetContent += ` (-${deletions})`;
  }
  
  // Add hashtags
  tweetContent += '\n\n#coding #github #development';
  
  // Ensure tweet is within character limit
  if (tweetContent.length > 280) {
    tweetContent = tweetContent.substring(0, 275) + '...';
  }
  
  return tweetContent;
}

// Detect commit type from message
function detectCommitType(message) {
  const lowerMessage = message.toLowerCase();
  
  if (lowerMessage.includes('feat:') || lowerMessage.includes('feature:')) return 'feature';
  if (lowerMessage.includes('fix:') || lowerMessage.includes('bug:')) return 'fix';
  if (lowerMessage.includes('docs:') || lowerMessage.includes('documentation')) return 'docs';
  if (lowerMessage.includes('refactor:') || lowerMessage.includes('refactoring')) return 'refactor';
  if (lowerMessage.includes('test:') || lowerMessage.includes('testing')) return 'test';
  if (lowerMessage.includes('style:') || lowerMessage.includes('styling')) return 'style';
  
  return 'general';
}

// Post tweet
async function postTweet(content) {
  try {
    const tweet = await twitterClient.v2.tweet(content);
    console.log('Tweet posted successfully:', tweet.data.id);
    return tweet;
  } catch (error) {
    console.error('Error posting tweet:', error);
    throw error;
  }
}

// Fetch additional commit details from GitHub API
async function fetchCommitDetails(repoFullName, commitSha) {
  try {
    const response = await axios.get(
      `https://api.github.com/repos/${repoFullName}/commits/${commitSha}`,
      {
        headers: {
          'Authorization': `token ${config.github.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching commit details:', error);
    return null;
  }
}

// Main webhook handler
app.post('/webhook', async (req, res) => {
  try {
    // Verify GitHub signature
    const signature = req.headers['x-hub-signature-256'];
    const payload = JSON.stringify(req.body);
    
    if (!verifyGitHubSignature(payload, signature)) {
      return res.status(401).send('Unauthorized');
    }
    
    const event = req.headers['x-github-event'];
    
    // Handle push events
    if (event === 'push') {
      const { commits, repository, pusher } = req.body;
      
      // Skip if no commits or if it's a merge commit without changes
      if (!commits || commits.length === 0) {
        return res.status(200).send('No commits to process');
      }
      
      // Process the latest commit
      const latestCommit = commits[commits.length - 1];
      
      // Skip if commit message contains [skip-tweet] or similar
      if (latestCommit.message.includes('[skip-tweet]') || 
          latestCommit.message.includes('[no-tweet]')) {
        console.log('Skipping tweet due to skip flag in commit message');
        return res.status(200).send('Tweet skipped');
      }
      
      // Fetch additional commit details
      const commitDetails = await fetchCommitDetails(
        repository.full_name, 
        latestCommit.id
      );
      
      // Merge webhook data with API data
      const enrichedCommit = {
        ...latestCommit,
        stats: commitDetails?.stats,
        repository: repository.name,
        repositoryUrl: repository.html_url,
        author: commitDetails?.author || latestCommit.author
      };
      
      // Analyze commit and generate tweet
      const tweetContent = analyzeCommit(enrichedCommit);
      
      // Post tweet
      await postTweet(tweetContent);
      
      console.log(`Tweet posted for commit: ${latestCommit.id.substring(0, 7)}`);
    }
    
    res.status(200).send('Webhook processed successfully');
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal server error');
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(config.port, () => {
  console.log(`GitHub Twitter Bot server running on port ${config.port}`);
});

// module.exports = app;