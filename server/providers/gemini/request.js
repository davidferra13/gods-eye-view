import { isIP } from 'node:net';
import { readRequestBody } from '../common/request.js';
import { admitSameSiteRequest } from '../../../src/localRequestGate.mjs';
import {
  isAllowedHost,
  resolveAllowedHosts,
} from '../../../build/allowedHosts.js';

/** Explicit owner-only Tailscale Serve opt-in; never trust headers from LAN peers. */
function trustedOwnerProxy(req, configured = {}) {
  const headers = req.headers || {};
  const peer = String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  if (!['127.0.0.1', '::1'].includes(peer)) return false;
  let expected;
  try {
    expected = new URL(String(configured.origin || ''));
  } catch {
    return false;
  }
  if (
    expected.protocol !== 'https:' ||
    expected.username ||
    expected.password ||
    expected.pathname !== '/' ||
    expected.search ||
    expected.hash ||
    !/^[a-z0-9-]+\.tail[a-z0-9]+\.ts\.net$/.test(expected.hostname)
  )
    return false;
  const login = String(configured.login || '')
    .trim()
    .toLowerCase();
  if (
    !login ||
    !login.includes('@') ||
    String(headers['tailscale-user-login'] || '')
      .trim()
      .toLowerCase() !== login ||
    headers.host !== expected.host ||
    headers.origin !== expected.origin ||
    headers['x-forwarded-proto'] !== 'https'
  )
    return false;
  // No public CDN, nested proxy, or caller-supplied forwarding chain is admitted.
  if (
    ['forwarded', 'via', 'x-real-ip', 'cf-ray', 'cf-connecting-ip'].some(
      (name) => String(headers[name] || '').trim(),
    )
  )
    return false;
  if (
    headers['x-forwarded-host'] &&
    headers['x-forwarded-host'] !== expected.host
  )
    return false;
  if (
    headers['x-forwarded-port'] &&
    headers['x-forwarded-port'] !== (expected.port || '443')
  )
    return false;
  const address = String(headers['x-forwarded-for'] || '').trim();
  const version = isIP(address);
  if (version === 4) {
    const parts = address.split('.').map(Number);
    return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
  }
  return version === 6 && address.toLowerCase().startsWith('fd7a:115c:a1e0:');
}

/** Use the app's Host and request policies, with a required browser Origin. */
export function isGeminiRequestOriginAllowed(
  req,
  configuredHost = '',
  configuredAllowedHosts,
  trustedProxy = {},
) {
  const host = req.headers?.host;
  const origin = req.headers?.origin;
  if (
    typeof host !== 'string' ||
    typeof origin !== 'string' ||
    !host ||
    !origin ||
    /[\s/?#@\\]/.test(host)
  )
    return false;
  const relay = trustedOwnerProxy(req, trustedProxy);
  const protocol = relay || req.socket?.encrypted ? 'https:' : 'http:';
  if (
    !admitSameSiteRequest({
      hostHeader: host,
      protocol,
      origin,
      secFetchSite: req.headers?.['sec-fetch-site'],
      proxyHeaders: relay ? {} : req.headers || {},
    }).ok
  )
    return false;
  // The shared gate compares a present Origin exactly with this authority;
  // this route also requires the Origin and an allowed Host.
  const boundHost = String(configuredHost || '')
    .trim()
    .toLowerCase();
  return isAllowedHost(host, resolveAllowedHosts(configuredAllowedHosts), [
    boundHost,
  ]);
}

/** Admit only the existing input gesture; callers cannot supply model/setup. */
export async function readGeminiTokenRequest(req, signal, maxBytes = 1024) {
  const declared = Number(req.headers?.['content-length']);
  const fail = (code) =>
    Object.assign(new Error('Invalid token request'), { code });
  const body = await readRequestBody(
    req,
    maxBytes,
    Number.isFinite(declared) && declared > maxBytes
      ? AbortSignal.abort(fail('BODY_TOO_LARGE'))
      : signal,
  );
  if (!body.trim()) return 'open-mic';
  if (
    !/^application\/json(?:\s*;|$)/i.test(req.headers?.['content-type'] || '')
  )
    throw fail('BAD_CONTENT_TYPE');
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw fail('BAD_BODY');
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
    throw fail('BAD_BODY');
  const keys = Object.keys(parsed);
  if (!keys.length) return 'open-mic';
  if (
    keys.length === 1 &&
    keys[0] === 'inputMode' &&
    parsed.inputMode === 'push-to-talk'
  )
    return 'push-to-talk';
  throw fail('BAD_BODY');
}
