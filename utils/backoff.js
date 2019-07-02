'use strict';

// exponential back-off with jitter

const {random} = require('./random');

// full jitter
const jitter = random;

const backoff = function*(from = 50, to = 60000, finite = false) {
  for (let x = from; x < to; x *= 2) {
    yield jitter(x);
  }
  if (finite) {
    yield jitter(to);
    return;
  }
  for (;;) {
    yield jitter(to);
  }
};

module.exports = backoff;
