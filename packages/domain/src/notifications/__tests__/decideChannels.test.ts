// packages/domain/src/notifications/__tests__/decideChannels.test.ts
import { describe, it, expect } from 'vitest';
import { decideChannels } from '../decideChannels';

describe('decideChannels', () => {
  it('returns the template channel when no prefs are passed', () => {
    expect(decideChannels('email')).toEqual(['email']);
    expect(decideChannels('sms')).toEqual(['sms']);
    expect(decideChannels('push')).toEqual(['push']);
    expect(decideChannels('inapp')).toEqual(['inapp']);
  });

  it('returns the channel when prefs is the empty object', () => {
    expect(decideChannels('email', {})).toEqual(['email']);
  });

  it('filters out email when optOutEmail is true', () => {
    expect(decideChannels('email', { optOutEmail: true })).toEqual([]);
  });

  it('filters out sms when optOutSms is true', () => {
    expect(decideChannels('sms', { optOutSms: true })).toEqual([]);
  });

  it('keeps the channel when only an unrelated opt-out flag is set', () => {
    expect(decideChannels('email', { optOutSms: true, optOutPush: true })).toEqual(['email']);
  });

  it('treats opt-out=false as opted-in (explicit consent)', () => {
    expect(decideChannels('email', { optOutEmail: false })).toEqual(['email']);
  });

  it('treats missing opt-out flag as opted-in (default)', () => {
    // With exactOptionalPropertyTypes the only way to express "no flag"
    // is to omit the key entirely.
    const prefs: { optOutEmail?: boolean } = {};
    expect(decideChannels('email', prefs)).toEqual(['email']);
  });

  it('filters out push when optOutPush is true', () => {
    expect(decideChannels('push', { optOutPush: true })).toEqual([]);
  });

  it('filters out inapp when optOutInApp is true', () => {
    expect(decideChannels('inapp', { optOutInApp: true })).toEqual([]);
  });
});
