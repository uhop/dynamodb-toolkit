'use strict';

// check for consistency

const positive = {yes: 1, true: 1, '1': 1, on: 1};

const isTrue = (query, name) => (query[name] && positive[query[name].toLowerCase()] === 1) || false;

const isConsistent = query => isTrue(query, 'consistent');
const isActive = query => isTrue(query, 'active');
const isLocked = query => isTrue(query, 'locked');

module.exports.isTrue = isTrue;
module.exports.isConsistent = isConsistent;
module.exports.isActive = isActive;
module.exports.isLocked = isLocked;
