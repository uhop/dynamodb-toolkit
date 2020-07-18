'use strict';

const getProfileName = require('./getProfileName');

const getOptions = (AWS, {profile, warn} = {}) => {
  if (typeof profile == 'undefined') profile = getProfileName();
  if (!profile) return {};

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
  return options;
};


const makeClient = (AWS, pragmas, options) => {
  const configOptions = getOptions(AWS, pragmas),
    opt = {...configOptions, ...options};
  return pragmas && pragmas.isDocClient ? new AWS.DynamoDB.DocumentClient(opt) : new AWS.DynamoDB(opt);
};
makeClient.getOptions = getOptions;

module.exports = makeClient;
