'use strict';

const getProfileName = require('./getProfileName');

const createClient = (AWS, profile, warn) => {
  if (typeof profile == 'undefined') profile = getProfileName();
  if (!profile) return new AWS.DynamoDB();

  let region = '',
    credentials;
  const iniLoader = new AWS.IniLoader();
  try {
    const config = iniLoader.loadFrom({isConfig: true});
    if (config[profile]) {
      region = config[profile].region;
    } else if (config.default && profile !== 'default') {
      warn && console.log(`Warning: there is no configuration corresponding to profile "${profile}" --- trying the default...`);
      region = config.default.region;
    } else {
      warn && console.log('Warning: there is no default configuration --- ignoring...');
    }
  } catch (e) {
    warn && console.log('Warning: there is no default config file --- ignoring...');
  }
  let tryDefault = profile === 'default';
  if (!tryDefault) {
    try {
      credentials = new AWS.SharedIniFileCredentials({profile});
    } catch (e) {
      warn && console.log(`Warning: there are no credentials corresponding to profile "${profile}" --- trying the default...`);
      tryDefault = true;
    }
  }
  if (tryDefault) {
    try {
      credentials = new AWS.SharedIniFileCredentials({profile: 'default'});
    } catch (e) {
      warn && console.log('Warning: there are no default credentials --- ignoring...');
      tryDefault = true;
    }
  }
  const options = {};
  if (region) options.region = region;
  if (credentials) options.credentials = credentials;
  return new AWS.DynamoDB(options);
};

module.exports = createClient;
