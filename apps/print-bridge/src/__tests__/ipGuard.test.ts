import { describe, it, expect } from 'vitest';
import { isPrivateIpv4, isPrivatePrefix } from '../ipGuard.js';

describe('isPrivateIpv4', () => {
  it.each(['192.168.1.50', '10.0.0.1', '172.16.0.1', '172.31.255.254', '127.0.0.1'])('accepts %s', (ip) => {
    expect(isPrivateIpv4(ip)).toBe(true);
  });
  it.each(['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.0.1', '256.1.1.1', 'evil.host', '192.168.1', ''])(
    'rejects %s',
    (ip) => { expect(isPrivateIpv4(ip)).toBe(false); },
  );
});

describe('isPrivatePrefix', () => {
  it.each(['192.168.1', '10.0.0', '172.16.4'])('accepts %s', (p) => {
    expect(isPrivatePrefix(p)).toBe(true);
  });
  it.each(['8.8.8', '172.32.0', '192.168', '192.168.1.5', 'foo'])('rejects %s', (p) => {
    expect(isPrivatePrefix(p)).toBe(false);
  });
});
