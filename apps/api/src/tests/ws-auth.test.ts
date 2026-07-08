import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';

// ---- Env stub (must run before importing any module that pulls in config/env) ----
process.env['NODE_ENV'] = 'test';
process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
process.env['REDIS_URL'] = 'redis://localhost:6379';
process.env['SESSION_SECRET'] = 'test-session-secret-minimum-32-chars!!';
process.env['JWT_SECRET'] = 'test-jwt-secret-minimum-32-chars!!!!!';
process.env['ALLOWED_ORIGIN_PATTERN'] = 'https://*.platform.dz';
process.env['PHONE_HMAC_SECRET'] = 'test-phone-hmac-secret-minimum-32-chars!!';

const { wsAuth } = await import('../realtime/ws.auth.js');
const { compileOriginPattern } = await import('../shared/originPattern.js');

const SHOP_ID = 'shop-1';
const TOKEN = jwt.sign({ sub: 'barber-1', shopId: SHOP_ID, name: 'Samir' }, process.env['JWT_SECRET']);

interface FakeSocket {
  destroyed: boolean;
  destroy(): void;
}

function fakeSocket(): FakeSocket {
  return {
    destroyed: false,
    destroy() {
      this.destroyed = true;
    },
  };
}

function upgrade(opts: { token?: string; shopId?: string; origin?: string }) {
  const params = new URLSearchParams();
  if (opts.token) params.set('token', opts.token);
  if (opts.shopId) params.set('shopId', opts.shopId);
  const req = {
    url: `/?${params.toString()}`,
    headers: opts.origin !== undefined ? { origin: opts.origin } : {},
  } as unknown as IncomingMessage;
  const socket = fakeSocket();
  const result = wsAuth(req, socket as unknown as Socket);
  return { result, socket };
}

describe('compileOriginPattern — full metacharacter escaping', () => {
  it('keeps the wildcard semantics (subdomains + optional apex, ports)', () => {
    const p = compileOriginPattern('https://*.platform.dz');
    assert.equal(p.test('https://shop.platform.dz'), true);
    assert.equal(p.test('https://platform.dz'), true);
    assert.equal(p.test('https://evil-platform.dz'), false);
    const local = compileOriginPattern('http://localhost:*');
    assert.equal(local.test('http://localhost:5173'), true);
  });

  it('treats regex metacharacters in the pattern as literals', () => {
    const p = compileOriginPattern('https://foo+bar.dz');
    assert.equal(p.test('https://foo+bar.dz'), true);
    assert.equal(p.test('https://fooobar.dz'), false); // '+' must not act as a quantifier
    // A backslash in the pattern can't smuggle regex syntax through.
    assert.equal(compileOriginPattern('https://a\\d.dz').test('https://a1.dz'), false);
  });
});

describe('wsAuth — Origin validation (cross-site WebSocket hijacking guard)', () => {
  it('allows an allowed subdomain origin', () => {
    const { result, socket } = upgrade({
      token: TOKEN,
      shopId: SHOP_ID,
      origin: 'https://algiers-cuts.platform.dz',
    });
    assert.ok(result);
    assert.equal(result.barberId, 'barber-1');
    assert.equal(socket.destroyed, false);
  });

  it('allows the bare apex origin', () => {
    const { result } = upgrade({ token: TOKEN, shopId: SHOP_ID, origin: 'https://platform.dz' });
    assert.ok(result);
  });

  it('allows a MISSING origin (non-browser clients; token still required)', () => {
    const { result } = upgrade({ token: TOKEN, shopId: SHOP_ID });
    assert.ok(result);
  });

  it('destroys the socket for a foreign origin even with a VALID token', () => {
    const { result, socket } = upgrade({
      token: TOKEN,
      shopId: SHOP_ID,
      origin: 'https://evil.com',
    });
    assert.equal(result, null);
    assert.equal(socket.destroyed, true);
  });

  it('rejects lookalike, nested and http-downgrade origins', () => {
    for (const origin of [
      'https://evil-platform.dz',
      'https://platform.dz.evil.com',
      'https://a.b.platform.dz',
      'http://platform.dz',
    ]) {
      const { result, socket } = upgrade({ token: TOKEN, shopId: SHOP_ID, origin });
      assert.equal(result, null, origin);
      assert.equal(socket.destroyed, true, origin);
    }
  });
});

describe('wsAuth — token checks stay fail-closed behind the origin gate', () => {
  it('an allowed origin does NOT rescue an invalid token', () => {
    const { result, socket } = upgrade({
      token: 'garbage',
      shopId: SHOP_ID,
      origin: 'https://algiers-cuts.platform.dz',
    });
    assert.equal(result, null);
    assert.equal(socket.destroyed, true);
  });

  it('rejects a token whose shopId does not match the requested shop', () => {
    const { result, socket } = upgrade({
      token: TOKEN,
      shopId: 'other-shop',
      origin: 'https://algiers-cuts.platform.dz',
    });
    assert.equal(result, null);
    assert.equal(socket.destroyed, true);
  });

  it('rejects a missing token or shopId', () => {
    for (const opts of [{ shopId: SHOP_ID }, { token: TOKEN }]) {
      const { result, socket } = upgrade(opts);
      assert.equal(result, null);
      assert.equal(socket.destroyed, true);
    }
  });
});
