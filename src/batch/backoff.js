// Exponential back-off with full jitter.

const jitter = n => Math.floor(n * Math.random());

export const backoff = function* (from = 50, to = 60000, finite = false) {
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
