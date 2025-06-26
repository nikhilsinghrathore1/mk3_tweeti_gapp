import { App } from "@octokit/app";
import fs from "fs";

export const githubApp = new App({
  appId: process.env.GITHUB_APP_ID,
  privateKey: fs.readFileSync(process.env.GITHUB_PRIVATE_KEY_PATH, "utf8"),
});


// these are the config of twitter {
//     appKey: 'wZz2NKbIhvH1xClPHrRFHgzeL',
//     appSecret: '2Ny4ax6lEl5XAgN2ysI9O7zBgh4j7QBJFngulgBmwI7mVjSc7R',
//     accessToken: '1803042326954057728-RvJKrtOEyS2EYZ1gIlLK1jCInY2yCC',
//     accessSecret: '6sBBNpwtrNBwQglOUkX3TItfKndulTrwamSK1u3rlKAK2'
//   }