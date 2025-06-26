import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { TwitterApi } from "twitter-api-v2";
import { generateTweet } from "./src/config/gemini.js";
import pkg from 'pg';

const { Pool } = pkg;

dotenv.config();

const app = express();
app.use(express.json());

// Neon DB connection pool
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// Test database connection
async function testConnection() {
    try {
        const client = await pool.connect();
        console.log('✅ Connected to Neon DB successfully');
        client.release();
    } catch (error) {
        console.error('❌ Failed to connect to Neon DB:', error.message);
        process.exit(1);
    }
}

// Configuration
const config = {
    github: {
        appId: process.env.GITHUB_APP_ID,
        privateKey: process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n'),
        webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
        clientId: process.env.GITHUB_CLIENT_ID,
        clientSecret: process.env.GITHUB_CLIENT_SECRET
    },
    port: process.env.PORT || 3000
};

// Generate JWT for GitHub App authentication
function generateJWT() {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        iat: now - 60,
        exp: now + (10 * 60),
        iss: config.github.appId
    };

    return jwt.sign(payload, config.github.privateKey, { algorithm: 'RS256' });
}

async function getInstallationToken(installationId) {
    try {
        const jwtToken = generateJWT();

        const response = await axios.post(
            `https://api.github.com/app/installations/${installationId}/access_tokens`,
            {},
            {
                headers: {
                    'Authorization': `Bearer ${jwtToken}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        );

        return response.data.token;
    } catch (error) {
        console.error('Error getting installation token:', error.response?.data || error.message);
        throw error;
    }
}

// Fetch user credentials from Neon DB
async function getUserCredentials(githubUsername) {
    const client = await pool.connect();
    try {
        console.log(`🔍 Fetching credentials for GitHub user: ${githubUsername}`);

        // Query to fetch user credentials based on GitHub username
        const query = `
            SELECT access_token, access_secret 
            FROM x_credentials 
            WHERE github_username = $1
            LIMIT 1
        `;

        const result = await client.query(query, [githubUsername]);

        if (result.rows.length === 0) {
            console.log(`❌ No Twitter credentials found for GitHub user: ${githubUsername}`);
            return null;
        }

        const userCredentials = result.rows[0];
        console.log("this is user api tokens", userCredentials)
        console.log(`✅ Found Twitter credentials for user: ${githubUsername}`);

        return {
            appKey: process.env.TWITTER_API_KEY,
            appSecret: process.env.TWITTER_API_SECRET,
            accessToken: userCredentials.access_token,
            accessSecret: userCredentials.access_secret
        };
    } catch (error) {
        console.error('Error fetching user credentials:', error);
        throw error;
    } finally {
        client.release();
    }
}

// API endpoint to add/update user credentials

// API endpoint to get stored credentials (for debugging - remove in production)


// Testing endpoint to list all tables in the database


// Testing endpoint to describe a specific table structure


// Create Twitter client for specific user
function createTwitterClient(credentials) {
    console.log("these are the config of twitter", credentials);

    const twitterClient = new TwitterApi({
        appKey: credentials.appKey,
        appSecret: credentials.appSecret,
        accessToken: credentials.accessToken,
        accessSecret: credentials.accessSecret,
    });

    return twitterClient.readWrite;

}

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
async function analyzeCommit(commit, repository) {
    const { message, author, added, modified, removed } = commit;

    // Extract key information
    const changedFiles = added.length + modified.length + removed.length;
    const additions = commit.stats?.additions || 0;
    const deletions = commit.stats?.deletions || 0;

    // Detect commit type based on message
    const commitType = detectCommitType(message);

    // Build context for LLM
    const commitContext = {
        repository,
        message,
        author: author.name || author,
        commitType,
        stats: {
            changedFiles,
            additions,
            deletions,
            filesAdded: added.length,
            filesModified: modified.length,
            filesRemoved: removed.length
        }
    };

    // Create comprehensive prompt for LLM
    const prompt = `You are an expert Twitter copywriter specializing in writing high-performing developer tweets.

    Your task: Given the Git commit context below, write a **compelling tweet** that mirrors the style, structure, and energy of the examples.
    
    🔒 STRICT RULES (Must be followed):
    - Length: UNDER 240 characters
    - Tone: Human, witty, punchy — **not AI-generated**
    - Format: Follow the structure below EXACTLY
    - Use power verbs like: shipped, crushed, unleashed, crafted, revolutionized, upgraded
    - Emojis REQUIRED for section separation and visual impact
    - Always end with this line:
    - powered by Tweeti  
    #Coding #GitHub @arweaveIndia
    
    ---
    
    🔧 COMMIT CONTEXT:
    Project: ${commitContext.repository}  
    Commit Message: "${commitContext.message}"  
    Author: ${commitContext.author}  
    Commit Type: ${commitContext.commitType}
    
    ---
    💡EXAMPLE — Your tweet MUST match this tone & structure:
    📦 Refactored: The dashboard was a monster.  
    Split it into clean, modular components.  
    
    ✅ 20% faster load  
    ✅ Much easier to maintain  
    ✅ Dev sanity restored  
    
    Next step: reusable analytics blocks for other pages.
    ---
    
    🚫 DO NOT:
    - Write like a robot or AI
    - Skip emojis or hashtags
    - Change structure or omit the final hashtag line
    - always gives technical highlights in point given in EXAMPLE
    
    ✅ GOAL: Write a tweet a real dev would post and real devs would share.
    
    Now, generate a tweet.
    `;
    

//     const prompt = `You are a social media manager for a tech product.
// Given the following code update details, write a short, engaging tweet for end users (not developers):

// ${commitContext.message}

// Instructions:
// - Summarize the update in simple, friendly language.
// - Highlight how this change benefits or impacts users.
// - Use a conversational tone, add only relevant emojis.
// - If possible, mention the type of update (feature, bug fix, improvement, etc.).
// - End with a question or call to action to encourage engagement.
// - Make sure to frame tweet such that it is 280 characters or less.
// - Add a line break before tagging people.
// - Always tag @arweaveindia and @ropats16 at the end.
// `;
    try {
        // Generate tweet using LLM
        const tweetContent = await generateTweet(prompt);
        console.log("this is the tweet generated from the llm ->", tweetContent)
        return tweetContent;

    } catch (error) {
        console.error('Error generating tweet with LLM:', error);

        // Fallback tweet generation if LLM fails
        const fallbackTweet = generateFallbackTweet(commitContext);
        console.log('Using fallback tweet generation');
        return fallbackTweet;
    }
}

// Fallback tweet generation function
function generateFallbackTweet(commitContext) {
    const { repository, message, commitType, stats, author } = commitContext;
    const hashtags = getHashtagsForCommitType(commitType);

    // Truncate commit message if too long
    const truncatedMessage = message.length > 100 ? message.substring(0, 97) + '...' : message;

    const emojis = {
        feature: '✨',
        fix: '🐛',
        docs: '📚',
        refactor: '♻️',
        test: '🧪',
        style: '💄',
        chore: '🔧',
        general: '💻'
    };

    const emoji = emojis[commitType] || emojis.general;

    return `${emoji} Just pushed to ${repository}!

"${truncatedMessage}"

📊 ${stats.changedFiles} files, +${stats.additions}/-${stats.deletions} lines

${hashtags}`;
}

// Detect commit type from message
function detectCommitType(message) {
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.match(/^(feat|feature)[\(\:]/) || lowerMessage.includes('new feature')) return 'feature';
    if (lowerMessage.match(/^fix[\(\:]/) || lowerMessage.includes('bug fix')) return 'fix';
    if (lowerMessage.match(/^docs?[\(\:]/) || lowerMessage.includes('documentation')) return 'docs';
    if (lowerMessage.match(/^refactor[\(\:]/) || lowerMessage.includes('refactor')) return 'refactor';
    if (lowerMessage.match(/^test[\(\:]/) || lowerMessage.includes('test')) return 'test';
    if (lowerMessage.match(/^style[\(\:]/) || lowerMessage.includes('style')) return 'style';
    if (lowerMessage.match(/^chore[\(\:]/) || lowerMessage.includes('chore')) return 'chore';

    return 'general';
}

// Get hashtags based on commit type
function getHashtagsForCommitType(commitType) {
    const hashtagMap = {
        feature: '#NewFeature #Development #Coding #GitHub @ropats16 @arweaveindia @onlyarweave',
        fix: '#BugFix #Development #Coding #GitHub @ropats16 @arweaveindia @onlyarweave',
        docs: '#Documentation #GitHub #OpenSource @ropats16 @arweaveindia @onlyarweave',
        refactor: '#Refactoring #CleanCode #Development #GitHub @ropats16 @arweaveindia @onlyarweave',
        test: '#Testing #QualityAssurance #Development #GitHub @ropats16 @arweaveindia @onlyarweave',
        style: '#CodeStyle #Development #GitHub @ropats16 @arweaveindia @onlyarweave',
        chore: '#Maintenance #Development #GitHub @ropats16 @arweaveindia @onlyarweave',
        general: '#Coding #Development #GitHub #OpenSource @ropats16 @arweaveindia @onlyarweave'
    };

    return hashtagMap[commitType] || hashtagMap.general;
}

// Post tweet using user-specific Twitter client
async function postTweet(content, twitterClient) {
    try {
        const tweet = await twitterClient.v2.tweet(content);
        console.log('✅ Tweet posted successfully:', tweet.data.id);
        return tweet;
    } catch (error) {
        console.error('❌ Error posting tweet:', error);
        throw error;
    }
}

// Fetch commit details using installation token
async function fetchCommitDetails(repoFullName, commitSha, installationId) {
    try {
        const token = await getInstallationToken(installationId);

        const response = await axios.get(
            `https://api.github.com/repos/${repoFullName}/commits/${commitSha}`,
            {
                headers: {
                    'Authorization': `token ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            }
        );
        return response.data;
    } catch (error) {
        console.error('❌ Error fetching commit details:', error.response?.data || error.message);
        return null;
    }
}

// Main webhook handler
app.post('/webhook', async (req, res) => {
    console.log('🔔 Webhook received at:', new Date().toISOString());
    console.log('📋 Headers:', {
        event: req.headers['x-github-event'],
        delivery: req.headers['x-github-delivery'],
        signature: req.headers['x-hub-signature-256'] ? 'Present' : 'Missing'
    });

    try {
        // Verify GitHub signature
        const signature = req.headers['x-hub-signature-256'];
        const payload = JSON.stringify(req.body);

        console.log('🔐 Verifying signature...');
        if (!verifyGitHubSignature(payload, signature)) {
            console.log('❌ Signature verification failed');
            return res.status(401).send('Unauthorized');
        }
        console.log('✅ Signature verified');

        const event = req.headers['x-github-event'];

        // Handle installation events
        if (event === 'installation') {
            const { action, installation } = req.body;
            console.log(`📦 Installation event: ${action} for installation ${installation.id}`);
            return res.status(200).send('Installation event processed');
        }

        // Handle push events
        if (event === 'push') {
            const { commits, repository, installation, pusher } = req.body;
            console.log(`📦 Push event from ${repository.full_name} by ${pusher.name}`);
            console.log(`🔧 Installation ID: ${installation.id}`);
            console.log(`📝 ${commits.length} commit(s) received`);

            // Skip if no commits
            if (!commits || commits.length === 0) {
                console.log('⏭️ No commits to process');
                return res.status(200).send('No commits to process');
            }

            // Process the latest commit
            const latestCommit = commits[commits.length - 1];
            console.log(`🔍 Processing commit: ${latestCommit.id.substring(0, 7)} - "${latestCommit.message}"`);

            // Skip if commit message contains skip flags
            if (latestCommit.message.includes('[skip-tweet]') ||
                latestCommit.message.includes('[no-tweet]') ||
                latestCommit.message.includes('[skip ci]')) {
                console.log('⏭️ Skipping tweet due to skip flag in commit message');
                return res.status(200).send('Tweet skipped');
            }

            // // Skip merge commits
            // if (latestCommit.message.startsWith('Merge ')) {
            //     console.log('⏭️ Skipping merge commit');
            //     return res.status(200).send('Merge commit skipped');
            // }

            // Get GitHub username from pusher info
            const githubUsername = pusher.name || pusher.username || latestCommit.author.username;

            if (!githubUsername) {
                console.log('❌ Could not determine GitHub username');
                return res.status(400).send('GitHub username not found');
            }

            // Fetch user-specific Twitter credentials
            const userCredentials = await getUserCredentials(githubUsername);

            if (!userCredentials) {
                console.log(`❌ No Twitter credentials found for user: ${githubUsername}`);
                return res.status(200).send(`No Twitter credentials configured for user: ${githubUsername}`);
            }

            // Create user-specific Twitter client
            const userTwitterClient = createTwitterClient(userCredentials);

            // Fetch additional commit details using GitHub App authentication
            console.log('🔄 Fetching additional commit details from GitHub API...');
            const commitDetails = await fetchCommitDetails(
                repository.full_name,
                latestCommit.id,
                installation.id
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
            console.log('🤖 Analyzing commit and generating tweet...');
            const tweetContent = await analyzeCommit(enrichedCommit, repository.name);


            // Post tweet using user-specific credentials
            console.log(`🐦 Posting to Twitter for user: ${githubUsername}...`);
            await postTweet(tweetContent, userTwitterClient);

            console.log(`✅ Tweet posted successfully for commit: ${latestCommit.id.substring(0, 7)} by ${githubUsername}`);
        }

        res.status(200).send('Webhook processed successfully');

    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).send('Internal server error');
    }
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT COUNT(*) as user_count FROM x_credentials');
        const userCount = result.rows[0].user_count;
        client.release();

        res.status(200).json({
            status: 'OK',
            timestamp: new Date().toISOString(),
            appId: config.github.appId,
            database: 'Connected to Neon DB',
            storedUsers: parseInt(userCount)
        });
    } catch (error) {
        console.error('Health check failed:', error);
        res.status(500).json({
            status: 'ERROR',
            timestamp: new Date().toISOString(),
            appId: config.github.appId,
            database: 'Connection failed',
            error: error.message
        });
    }
});

// Start server
app.listen(config.port, async () => {
    console.log(`🚀 GitHub App Twitter Bot server running on port ${config.port}`);
    console.log(`📱 App ID: ${config.github.appId}`);
    console.log(`🔗 Install URL: https://github.com/apps/${process.env.GITHUB_APP_NAME}/installations/new`);
    console.log(`🗄️ Using Neon PostgreSQL Database`);

    // Test database connection on startup
    await testConnection();
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('🛑 Shutting down gracefully...');
    try {
        await pool.end();
        console.log('✅ Database connection pool closed');
    } catch (error) {
        console.error('❌ Error closing database connection:', error);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down gracefully...');
    try {
        await pool.end();
        console.log('✅ Database connection pool closed');
    } catch (error) {
        console.error('❌ Error closing database connection:', error);
    }
    process.exit(0);
});