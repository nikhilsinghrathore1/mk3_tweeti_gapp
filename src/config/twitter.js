import { TwitterApi } from 'twitter-api-v2';

export const twitterClient = new TwitterApi({
  appKey: process.env.XAPIKEY,
  appSecret: process.env.XAPIKEYSECRET,
  accessToken: process.env.ACCESSTOKEN,
  accessSecret: process.env.ACCESSTOKENSECRET,
});

export const rwClient = twitterClient.readWrite;