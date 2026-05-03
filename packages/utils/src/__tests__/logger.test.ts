// packages/utils/src/__tests__/logger.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, setBreadcrumbHook } from '../logger';

describe('logger', () => {
  beforeEach(() => setBreadcrumbHook(null));

  it('calls console.log for debug', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logger.debug('hi');
    expect(spy).toHaveBeenCalledWith('[debug]', 'hi');
    spy.mockRestore();
  });

  it('forwards to breadcrumb hook if set', () => {
    const hook = vi.fn();
    setBreadcrumbHook(hook);
    logger.info('event', { x: 1 });
    expect(hook).toHaveBeenCalledWith('info', 'event', { x: 1 });
  });

  it('calls console.warn for warn', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    logger.warn('oops');
    expect(spy).toHaveBeenCalledWith('[warn]', 'oops');
    spy.mockRestore();
  });

  it('calls console.error for error', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    logger.error('fail', { code: 500 });
    expect(spy).toHaveBeenCalledWith('[error]', 'fail', { code: 500 });
    spy.mockRestore();
  });

  it('calls console.info for info without data', () => {
    const spy = vi.spyOn(console, 'info').mockImplementation(() => {});
    logger.info('hello');
    expect(spy).toHaveBeenCalledWith('[info]', 'hello');
    spy.mockRestore();
  });
});
