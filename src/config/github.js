import { App } from '@octokit/app';
import fs from 'fs';

export const githubApp = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, 'utf8'),
});