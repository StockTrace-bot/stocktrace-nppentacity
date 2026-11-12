import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../login.html', import.meta.url), 'utf8');

test('login inline JavaScript parses before deployment', () => {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/.test(match[1]));
  assert.equal(blocks.length, 1, 'Expected exactly one inline login script');
  assert.doesNotThrow(() => new vm.Script(blocks[0][2], { filename: 'login.html:inline-script' }));
});
