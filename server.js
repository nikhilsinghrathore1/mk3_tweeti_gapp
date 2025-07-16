import express from "express";
import axios from "axios";
import crypto from "crypto";
import dotenv from "dotenv";
import jwt from "jsonwebtoken";
import { TwitterApi } from "twitter-api-v2";
import { generateTweet } from "./src/config/gemini.js";
import pkg from 'pg';
import cors from "cors"

const { Pool } = pkg;

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors({ origin: "*" }));

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
        accessToken: `1803042326954057728-ppWh3BGb0P5tgUBHyDIvPiqwA6MG9b`,
        accessSecret: `LxGj79LV927mF8VVVQY6XLT6BsDlQzrVZWegR0bPwossl`,
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

    ---
    
    🔧 COMMIT CONTEXT:
    Project: ${commitContext.repository}  
    Commit Message: "${commitContext.message}"  
    Author: ${commitContext.author}  
    Commit Type: ${commitContext.commitType}
    
    ---
    💡EXAMPLES
    1.i have spent hours debugging auth only to find a missing comma?
    
    Just fixed JWT middleware that was failing silently on token refresh.
    Users can now stay logged in without random logouts every few minutes.

    #GitHub @arweaveIndia.
    ---
    
    🚫 DO NOT:
    - Write like a robot or AI
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


app.post('/webhook', async (req, res) => {
    console.log('🔔 Webhook received at:', new Date().toISOString());
    console.log('📋 Headers:', {
        event: req.headers['x-github-event'],
        delivery: req.headers['x-github-delivery'],
        signature: req.headers['x-hub-signature-256'] ? 'Present' : 'Missing'
    });

    try {
        const signature = req.headers['x-hub-signature-256'];
        const payload = JSON.stringify(req.body);

        console.log('🔐 Verifying signature...');
        if (!verifyGitHubSignature(payload, signature)) {
            console.log('❌ Signature verification failed');
            return res.status(401).send('Unauthorized');
        }
        console.log('✅ Signature verified');

        const event = req.headers['x-github-event'];

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
                console.log('⏭️ Skipping commit due to skip flag in commit message');
                return res.status(200).send('Commit skipped');
            }

            // Get GitHub username from pusher info
            const githubUsername = pusher.name || pusher.username || latestCommit.author.username;

            if (!githubUsername) {
                console.log('❌ Could not determine GitHub username');
                return res.status(400).send('GitHub username not found');
            }

            // Check if user exists in database
            const client = await pool.connect();
            try {
                const userQuery = 'SELECT * FROM x_credentials WHERE github_username = $1';
                const userResult = await client.query(userQuery, [githubUsername]);

                if (userResult.rows.length === 0) {
                    console.log(`❌ No user record found for GitHub username: ${githubUsername}`);
                    return res.status(200).send(`No user record found for GitHub username: ${githubUsername}`);
                }

                const userRecord = userResult.rows[0];

                // Create commit message with repository info
                const commitMessage = `${latestCommit.message}`;

                // Get current commits array and add new commit
                const currentCommits = userRecord.commits || [];
                const updatedCommits = [...currentCommits, commitMessage];

                // Update user record to add commit message to commits array
                const updateQuery = 'UPDATE x_credentials SET commits = $1 WHERE github_username = $2 RETURNING *';
                const updateResult = await client.query(updateQuery, [updatedCommits, githubUsername]);

                console.log(`✅ Commit message stored successfully for user: ${githubUsername}`);
                console.log(`📝 Commit: ${commitMessage}`);
                console.log(`📊 Total commits stored: ${updatedCommits.length}`);

            } catch (dbError) {
                console.error('❌ Database error:', dbError);
                return res.status(500).send('Database error');
            } finally {
                client.release();
            }
        }

        res.status(200).send('Webhook processed successfully');

    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).send('Internal server error');
    }
});

app.get("/all_user", async (req, res) => {
    try {
        const client = await pool.connect();

        const updateQuery = `
                SELECT * FROM x_credentials
            `;
        const updateResult = await client.query(updateQuery);
        console.log(updateResult.rows)
        const finalUsers = updateResult.rows;
        res.status(200).json({ msg: "these are all the users", finalUsers })

    } catch (e) {
        console.log("this is the error ", e)
        res.status(400).json({ msg: "internal server issue " })
    }
})

app.post("/cron_post", async (req, res) => {
    try {

        const client = await pool.connect();

        try {
            console.log('🚀 Starting cron job for automated tweet posting...');

            // Fetch all users from database
            const updateQuery = `SELECT * FROM x_credentials`;
            const updateResult = await client.query(updateQuery);
            const finalUsers = updateResult.rows;

            console.log(`📊 Found ${finalUsers.length} users to process`);

            const results = [];

            // Process each user
            for (const user of finalUsers) {
                try {
                    console.log(`\n👤 Processing user: ${user.github_username}`);

                    // Check if user has commits to process
                    if (!user.commits || user.commits.length === 0) {
                        console.log(`⏭️ No commits found for user: ${user.github_username}`);
                        results.push({
                            user: user.github_username,
                            status: 'skipped',
                            reason: 'No commits found'
                        });
                        continue;
                    }

                    // Check if user has Twitter credentials
                    if (!user.access_token || !user.access_secret) {
                        console.log(`❌ No Twitter credentials for user: ${user.github_username}`);
                        results.push({
                            user: user.github_username,
                            status: 'failed',
                            reason: 'No Twitter credentials'
                        });
                        continue;
                    }

                    // Get the latest commit or combine multiple commits
                    const latestCommit = user.commits[user.commits.length - 1];
                    const recentCommits = user.commits.slice(-3); // Get last 3 commits

                    console.log(`📝 Processing ${recentCommits.length} recent commits for ${user.github_username}`);

                    // Create tweet content based on user's tone settings and commits
                    const tweetContent = await generateCronTweet(recentCommits, user);

                    if (!tweetContent) {
                        console.log(`❌ Failed to generate tweet for user: ${user.github_username}`);
                        results.push({
                            user: user.github_username,
                            status: 'failed',
                            reason: 'Tweet generation failed'
                        });
                        continue;
                    }

                    // Create Twitter client for this user
                    const twitterCredentials = {
                        appKey: process.env.TWITTER_API_KEY,
                        appSecret: process.env.TWITTER_API_SECRET,
                        accessToken: user.access_token,
                        accessSecret: user.access_secret
                    };

                    const twitterClient = createTwitterClient(twitterCredentials);

                    // Post the tweet
                    const tweet = await postTweet(tweetContent, twitterClient);

                    if (tweet) {
                        console.log(`✅ Tweet posted successfully for ${user.github_username}`);
                        console.log(`📱 Tweet ID: ${tweet.data.id}`);

                        // Clear processed commits from database
                        await clearProcessedCommits(user.github_username, client);

                        results.push({
                            user: user.github_username,
                            status: 'success',
                            tweetId: tweet.data.id,
                            content: tweetContent.substring(0, 100) + '...'
                        });
                    }

                } catch (userError) {
                    console.error(`❌ Error processing user ${user.github_username}:`, userError);
                    results.push({
                        user: user.github_username,
                        status: 'failed',
                        reason: userError.message
                    });
                }
            }

            console.log('\n📈 Cron job completed');
            console.log(`✅ Successfully processed: ${results.filter(r => r.status === 'success').length}`);
            console.log(`❌ Failed: ${results.filter(r => r.status === 'failed').length}`);
            console.log(`⏭️ Skipped: ${results.filter(r => r.status === 'skipped').length}`);

            res.status(200).json({
                msg: "Cron job completed successfully",
                summary: {
                    totalUsers: finalUsers.length,
                    successful: results.filter(r => r.status === 'success').length,
                    failed: results.filter(r => r.status === 'failed').length,
                    skipped: results.filter(r => r.status === 'skipped').length
                },
                results: results
            });

        } finally {
            client.release();
        }

    } catch (e) {
        console.error("❌ Cron job error:", e);
        res.status(500).json({
            msg: "Internal server error: " + e.message,
            error: e.toString()
        });
    }
});

// Helper function to generate tweet content for cron job
async function generateCronTweet(commits, user) {
    try {
        const userTone = user.tone ? JSON.parse(user.tone) : {};
        const githubUsername = user.github_username;

        // Create a summary of commits
        const commitSummary = commits.map((commit, index) =>
            `${index + 1}. ${commit}`
        ).join('\n');

        // Build dynamic prompt based on user's tone settings
        const toneInstructions = buildToneInstructions(userTone);

        const prompt = `You are an expert Twitter copywriter creating authentic developer update tweets.

🔒 STRICT REQUIREMENTS:
- Length: UNDER 230 characters
- Tone: ${toneInstructions.tone}
- Style: ${toneInstructions.style}
- Audience: ${toneInstructions.audience}
- Formality: ${toneInstructions.formality}

📝 RECENT COMMITS SUMMARY:
Developer: ${githubUsername}
Recent work: ${commitSummary}

🎯 TWEET STRUCTURE:
1. Hook/Opening (what you've been working on)
2. Key technical highlight or achievement
3. Impact or result
4. Closing with engagement

${toneInstructions.keywords ? `🔑 KEYWORDS TO INCLUDE: ${toneInstructions.keywords}` : ''}

📋 ENHANCED EXAMPLES:

🔥 Problem-Solving Victory:
"spent 3 days debugging a memory leak 🐛

turns out it was a single missing cleanup in our WebSocket handler

app now runs 40% smoother, no more random crashes

anyone else have those "duh" moments that make you question everything?

#debugging #javascript #webdev"

🚀 Feature Launch:
"new feature just dropped! 🎉

built real-time collaborative editing from scratch
- conflict resolution ✅
- 99.9% uptime ✅
- sub-100ms latency ✅

feels like magic when it all clicks

what's your favorite real-time feature to build?

#reactjs #websockets #collaboration"

🛠️ Technical Achievement:
"rewrote our entire CI/CD pipeline this week ⚡

docker → kubernetes → zero-downtime deployments

went from 45min builds to 8min builds

the dopamine hit from green checkmarks is unmatched

#devops #kubernetes #cicd"

💡 Learning/Discovery:
"TIL: you can use CSS container queries for responsive components 🤯

no more media queries cluttering up my stylesheets

component-driven responsive design is the future

drop your favorite CSS tricks below 👇

#css #frontend #webdev"

🔧 Refactoring Win:
"deleted 2,000 lines of code today 🗑️

replaced legacy authentication system with NextAuth.js

same functionality, 80% less maintenance overhead

sometimes the best code is the code you don't write

#nextjs #typescript #refactoring"

📊 Performance Improvement:
"optimized our database queries over the weekend 📈

added proper indexing + query optimization
- 300ms → 12ms response times
- 95% reduction in server load

users are actually noticing the speed difference

#postgresql #performance #backend"

🎨 UI/UX Enhancement:
"redesigned our dashboard from the ground up ✨

switched to shadcn/ui components
- cleaner code
- better accessibility
- 50% faster load times

dark mode hits different when done right 🌙

#ui #design #react"

🧪 Experimental/Side Project:
"weekend experiment: built a VS Code extension 🔌

auto-generates TypeScript interfaces from API responses

saved myself 2 hours already this week

building tools for yourself is peak developer satisfaction

#vscode #typescript #productivity"

🔄 Migration/Modernization:
"migrated 50k+ users from Firebase to Supabase 📦

zero downtime, zero data loss, zero complaints

open source alternatives hitting different these days

what's your go-to backend stack in 2025?

#supabase #migration #opensource"

🐛 Bug Hunt Victory:
"finally caught that Heisenbug that's been haunting production 👻

race condition in our event queue system

took 3 weeks but the fix was literally 2 lines

debugging distributed systems is an art form

#debugging #distributed #eventdriven"

🚨 Security Enhancement:
"hardened our API security this week 🔐

implemented rate limiting + JWT refresh rotation
- 99.9% reduction in bot traffic
- zero security incidents

sleep better knowing your app is bulletproof

#security #api #jwt"

🌟 Open Source Contribution:
"contributed to @vercel/next.js for the first time! 🎯

fixed an edge case in their image optimization

seeing your PR get merged into a tool you use daily = 🤌

what's your first open source contribution story?

#opensource #nextjs #community"

✅ FINAL REQUIREMENTS:
- Write like a real developer sharing genuine wins/struggles
- Include relevant emojis (2-4 max, strategically placed)
- End with 2-3 relevant hashtags
- ${toneInstructions.callToAction !== 'None' ? `Include a ${toneInstructions.callToAction.toLowerCase()}` : 'Optional call to action or question'}
- Keep it conversational and authentic
- Show technical depth without being overly complex
- Include specific metrics/results when possible

Generate the tweet now:`;

        const tweetContent = await generateTweet(prompt);

        if (!tweetContent) {
            throw new Error('LLM returned empty content');
        }

        // Validate tweet length
        if (tweetContent.length > 280) {
            console.warn(`Generated tweet is ${tweetContent.length} characters, may be too long`);
        }

        return tweetContent;

    } catch (error) {
        console.error('Error generating cron tweet:', error);

        // Enhanced fallback tweet generation
        const fallbackTweet = generateFallbackCronTweet(commits, user);
        console.log('Using fallback tweet generation for cron');
        return fallbackTweet;
    }
}

// Helper function to build tone instructions
function buildToneInstructions(toneSettings) {
    return {
        tone: Array.isArray(toneSettings.tone) ? toneSettings.tone.join(', ') : (toneSettings.tone || 'Professional, friendly'),
        style: Array.isArray(toneSettings.style) ? toneSettings.style.join(', ') : (toneSettings.style || 'Conversational'),
        audience: toneSettings.audience || 'Fellow developers',
        formality: toneSettings.formality || 'Semi-formal',
        keywords: toneSettings.keywords || '',
        callToAction: toneSettings.callToAction || 'None'
    };
}

// Fallback tweet generation for cron job
function generateFallbackCronTweet(commits, user) {
    const githubUsername = user.github_username;
    const commitCount = commits.length;

    // Get the most recent commit
    const latestCommit = commits[commits.length - 1];
    const truncatedMessage = latestCommit.length > 80 ?
        latestCommit.substring(0, 77) + '...' : latestCommit;

    const emojis = ['💻', '🚀', '⚡', '🔧', '✨', '🎯'];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];

    const templates = [
        `${randomEmoji} Just pushed ${commitCount} update${commitCount > 1 ? 's' : ''} today!

Latest: "${truncatedMessage}"

Another day of building cool stuff 🛠️

#coding #github #devlife`,

        `${randomEmoji} Been busy coding today...

"${truncatedMessage}"

${commitCount > 1 ? `+ ${commitCount - 1} more commits` : ''}

What did you ship today? 🤔

#dev #github #coding`,

        `${randomEmoji} Today's development update:

${truncatedMessage}

Progress feels good! 📈

#github #coding #tech`
    ];

    const randomTemplate = templates[Math.floor(Math.random() * templates.length)];

    // Ensure it's under 240 characters
    if (randomTemplate.length > 240) {
        return randomTemplate.substring(0, 237) + '...';
    }

    return randomTemplate;
}

// Helper function to clear processed commits
async function clearProcessedCommits(githubUsername, client) {
    try {
        // First, get the current tone settings
        const getCurrentToneQuery = 'SELECT tone FROM x_credentials WHERE github_username = $1';
        const result = await client.query(getCurrentToneQuery, [githubUsername]);

        let updatedTone = null;

        if (result.rows.length > 0 && result.rows[0].tone) {
            try {
                // Parse the existing tone JSON
                const currentTone = JSON.parse(result.rows[0].tone);

                // Update the keywords field to null
                const updatedToneSettings = {
                    ...currentTone,
                    keywords: null
                };

                // Convert back to JSON string
                updatedTone = JSON.stringify(updatedToneSettings);
            } catch (parseError) {
                console.warn(`⚠️ Error parsing tone for ${githubUsername}, resetting to default:`, parseError);

                // Create default tone settings with keywords set to null
                const defaultTone = {
                    style: [],
                    tone: [],
                    audience: '',
                    formality: '',
                    length: '',
                    keywords: null,
                    brandVoice: '',
                    emotionalTone: '',
                    contentType: '',
                    callToAction: '',
                    targetEngagement: '',
                    industry: '',
                    hashtagStyle: ''
                };

                updatedTone = JSON.stringify(defaultTone);
            }
        } else {
            // If no tone exists, create default tone settings
            const defaultTone = {
                style: [],
                tone: [],
                audience: '',
                formality: '',
                length: '',
                keywords: null,
                brandVoice: '',
                emotionalTone: '',
                contentType: '',
                callToAction: '',
                targetEngagement: '',
                industry: '',
                hashtagStyle: ''
            };

            updatedTone = JSON.stringify(defaultTone);
        }

        // Clear commits and update tone in a single query
        const clearQuery = 'UPDATE x_credentials SET commits = $1, tone = $2 WHERE github_username = $3';
        await client.query(clearQuery, [[], updatedTone, githubUsername]);

        console.log(`🧹 Cleared commits and reset tone.keywords for user: ${githubUsername}`);

    } catch (error) {
        console.error(`❌ Error clearing commits and updating tone for ${githubUsername}:`, error);

        // Fallback: just clear commits if tone update fails
        try {
            const fallbackQuery = 'UPDATE x_credentials SET commits = $1 WHERE github_username = $2';
            await client.query(fallbackQuery, [[], githubUsername]);
            console.log(`🔄 Fallback: Only cleared commits for user: ${githubUsername}`);
        } catch (fallbackError) {
            console.error(`❌ Fallback also failed for ${githubUsername}:`, fallbackError);
        }
    }
}

app.post("/set_tone", async (req, res) => {
    const data = req.body;

    if (!data) {

        return res.status(400).json({ msg: "No tone data was found" });
    }
    console.log("this is the data ", data.toneSettings)
    // Validate required fields
    const {
        style,
        tone,
        audience,
        formality,
        length,
        keywords,
        brandVoice,
        emotionalTone,
        contentType,
        callToAction,
        targetEngagement,
        industry,
        hashtagStyle,
        github_username
    } = data;

    if (!github_username) {
        return res.status(400).json({ msg: "GitHub username is required" });
    }

    try {
        const client = await pool.connect();

        try {
            // Check if user exists
            const userQuery = 'SELECT * FROM x_credentials WHERE github_username = $1';
            const userResult = await client.query(userQuery, [github_username]);

            if (userResult.rows.length === 0) {
                return res.status(404).json({ msg: "User not found" });
            }
            const finalData = data.toneSettings;
            const toneData = {
                style: finalData.style || [],
                tone: finalData.tone || [],
                audience: finalData.audience || "General",
                formality: finalData.formality || "Professional",
                length: finalData.length || "Medium",
                keywords: finalData.keywords || "",
                brandVoice: finalData.brandVoice || "Authentic",
                emotionalTone: finalData.emotionalTone || "Neutral",
                contentType: finalData.contentType || "Educational",
                callToAction: finalData.callToAction || "None",
                targetEngagement: finalData.targetEngagement || "Likes",
                industry: finalData.industry || "Technology",
                hashtagStyle: finalData.hashtagStyle || "Minimal"
            };

            // Update user's tone settings
            const updateQuery = `
                UPDATE x_credentials 
                SET tone = $1 
                WHERE github_username = $2 
                RETURNING *
            `;

            const updateResult = await client.query(updateQuery, [
                JSON.stringify(toneData),
                github_username
            ]);
            console.log("this is the updated result ", updateResult)

            console.log(`✅ Tone settings updated for user: ${github_username}`);
            console.log(`📝 Tone data:`, toneData);

            res.status(200).json({
                msg: "Tone settings updated successfully",
                user: github_username,
                toneSettings: toneData
            });

        } catch (dbError) {
            console.error('❌ Database error:', dbError);
            res.status(500).json({ msg: "Database error: " + dbError.message });
        } finally {
            client.release();
        }

    } catch (e) {
        console.log("This is the error:", e);
        res.status(500).json({ msg: "Server error: " + e.message });
    }
});

// Start server
app.listen(config.port, async () => {
    console.log(`🗄️ Using Neon PostgreSQL Database`);

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
    }
    catch (e) {
        console.log("this is the error msg", e)
    }
    process.exit(0);
});