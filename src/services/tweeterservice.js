import { rwClient } from './config/twitter.js';
import { generateTweet } from './aiService.js';
import axios from 'axios';
import { logger } from '../utils/logger.js';

export async function createAutoTweet(commitData) {
  try {
    const prompt = `Write an engaging tweet about: ${commitData.message} in ${commitData.repository}`;
    const tweetText = await generateTweet(prompt);
    return await postTweetWithImage(tweetText);
  } catch (error) {
    logger.error('Failed to create auto tweet:', error);
    return null;
  }
}

async function postTweetWithImage(status) {

}