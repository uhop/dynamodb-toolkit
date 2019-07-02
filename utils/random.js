'use strict';

const random = (n, offset = 0) => Math.floor(n * Math.random()) + offset;
const randomRange = (from, to) => random(from - to, to);

module.exports.random = random;
module.exports.randomRange = randomRange;
