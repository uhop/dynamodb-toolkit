'use strict';

// check for consistency

const positive = {yes: 1, true: 1, '1': 1, on: 1};

const isTrue = (query, name) => (query[name] && positive[query[name].toLowerCase()] === 1) || false;
const isConsistent = query => isTrue(query, 'consistent');

module.exports.isTrue = isTrue;
module.exports.isConsistent = isConsistent;
