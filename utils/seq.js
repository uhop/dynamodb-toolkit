'use strict';

const sleep = require('./sleep');

const seqNoDelay = async (items, fn) => {
  for await (const item of items) {
    await fn(item);
  }
};

const seq = async (items, fn, ms, skipFirstDelay) => {
  if (isNaN(ms) || !isFinite(ms) || ms <= 0) return seqNoDelay(items, fn);
  let first = skipFirstDelay;
  for await (const item of items) {
    if (first) {
      first = false;
    } else {
      await sleep(ms);
    }
    await fn(item);
  }
};

module.exports = seq;
