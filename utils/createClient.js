'use strict';

const makeClient = require('./makeClient');

const createClient = (AWS, profile, warn) => makeClient(AWS, {profile, warn});

module.exports = createClient;
