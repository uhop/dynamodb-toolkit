'use strict';

const sleep = ms => new Promise(resolve => setTimeout(() => resolve(ms), ms));

module.exports = sleep;
