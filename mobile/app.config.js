// The config is app.json; this only adds the Firebase config for push (FCM) when google-services.json is present.
// scripts/build-android.sh copies it here from the private signing storage; it is not in git.
const fs = require('fs');
const path = require('path');

module.exports = ({ config }) => {
  if (fs.existsSync(path.join(__dirname, 'google-services.json'))) {
    config.android = { ...config.android, googleServicesFile: './google-services.json' };
  }
  return config;
};
