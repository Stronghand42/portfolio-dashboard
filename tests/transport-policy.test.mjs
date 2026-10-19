import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(process.env.DASHBOARD_HTML || new URL('../intraday/index.html', import.meta.url), 'utf8');
const transport = JSON.parse(readFileSync(new URL('../intraday/transport.json', import.meta.url), 'utf8'));
const tags = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => match[0]);
const policies = tags.filter(tag => /http-equiv="Content-Security-Policy"/i.test(tag));
assert.equal(policies.length, 1, 'The page must have one explicit security policy');
const content = policies[0].match(/\bcontent="([^"]*)"/i)?.[1];
assert.ok(content, 'The security policy must have content');
const directives = new Map(content.split(';').map(value => value.trim().split(/\s+/)).filter(parts => parts[0]).map(([name, ...values]) => [name, values]));
const connections = directives.get('connect-src') ?? [];

test('the configured live feed is allowed by the page connection policy', () => {
  const feed = new URL(transport.feed);
  assert.equal(feed.protocol, 'https:');
  assert.equal(feed.pathname, '/feed/');
  assert.equal(feed.username + feed.password + feed.search + feed.hash, '');
  assert.ok(connections.includes(feed.href), 'The configured live feed is blocked by connect-src');
});

test('connections stay limited to the selected feed and existing history source', () => {
  assert.deepEqual([...connections].sort(), ["'self'", 'https://raw.githubusercontent.com', transport.feed].sort());
});

test('other access and navigation restrictions remain in effect', () => {
  for (const [name, expected] of Object.entries({
    'default-src': ["'self'"],
    'script-src': ["'unsafe-inline'"],
    'style-src': ["'unsafe-inline'"],
    'img-src': ["'self'", 'data:'],
    'object-src': ["'none'"],
    'base-uri': ["'none'"],
    'form-action': ["'none'"]
  })) assert.deepEqual(directives.get(name), expected, name);
});
