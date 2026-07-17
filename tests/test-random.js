import test from 'tape-six';
import {random} from 'dynamodb-toolkit';

test('random: length and alphabet', t => {
  t.equal(random().length, 8, 'default length is 8');
  t.equal(random(16).length, 16, 'custom length honored');
  t.equal(random(0), '', 'zero length yields empty string');
  for (let i = 0; i < 20; ++i) {
    t.ok(/^[0-9a-z]+$/.test(random(32)), 'output stays within [0-9a-z]');
  }
});

test('random: unbiased across positions', t => {
  // regression: base36-padStart encoding kept even positions within '0'-'7'
  let high = 0;
  for (let i = 0; i < 50; ++i) {
    const s = random(8);
    for (let j = 0; j < s.length; j += 2) {
      if (s[j] > '7') ++high;
    }
  }
  t.ok(high > 0, 'even positions reach the full alphabet');
});
