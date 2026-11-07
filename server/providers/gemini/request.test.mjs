import test from 'node:test';
import assert from 'node:assert/strict';
import { isGeminiRequestOriginAllowed } from './request.js';

const authority = 'viewer.tail1234.ts.net:10459';
const origin = 'https://' + authority;
const trusted = { origin, login: 'owner@example.test' };
function request(headers = {}, address = '127.0.0.1') {
  return {
    socket: { remoteAddress: address, encrypted: false },
    headers: {
      host: authority,
      origin,
      'sec-fetch-site': 'same-origin',
      'x-forwarded-proto': 'https',
      'x-forwarded-for': '100.84.233.31',
      'tailscale-user-login': 'owner@example.test',
      ...headers,
    },
  };
}
const allowed = (req, config = trusted) =>
  isGeminiRequestOriginAllowed(
    req,
    '0.0.0.0',
    'viewer.tail1234.ts.net',
    config,
  );

test('explicit owner HTTPS proxy admits the genuine same-origin request', () => {
  assert.equal(allowed(request()), true);
});

test('proxy remains denied without both exact owner settings', () => {
  assert.equal(allowed(request(), {}), false);
  assert.equal(allowed(request(), { origin }), false);
  assert.equal(allowed(request(), { login: trusted.login }), false);
});

test('LAN clients cannot impersonate the trusted loopback relay', () => {
  assert.equal(allowed(request({}, '10.0.0.153')), false);
});

test('foreign, opaque and missing browser Origins stay denied', () => {
  for (const value of ['https://evil.example', 'null', undefined])
    assert.equal(allowed(request({ origin: value })), false);
});

test('other tailnet identities and cross-site browser requests stay denied', () => {
  assert.equal(
    allowed(request({ 'tailscale-user-login': 'guest@example.test' })),
    false,
  );
  assert.equal(allowed(request({ 'sec-fetch-site': 'cross-site' })), false);
});

test('public proxies and forged forwarding chains stay denied', () => {
  for (const headers of [
    { 'cf-ray': 'example' },
    { forwarded: 'for=100.1.2.3' },
    { 'x-forwarded-for': '8.8.8.8' },
    { 'x-forwarded-for': '100.1.2.3, 100.4.5.6' },
    { 'x-forwarded-proto': 'http' },
    { 'x-forwarded-host': 'evil.example' },
  ])
    assert.equal(allowed(request(headers)), false);
});

test('private host admission and secure exact authority are still required', () => {
  assert.equal(
    isGeminiRequestOriginAllowed(request(), '0.0.0.0', '', trusted),
    false,
  );
  assert.equal(allowed(request({ host: 'evil.example' })), false);
  assert.equal(
    allowed(request(), { origin: 'http://' + authority, login: trusted.login }),
    false,
  );
});
