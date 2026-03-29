import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger, LogLevel } from '../../src/shared/logger.js';

describe('createLogger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('logs to stderr as JSON', () => {
    const logger = createLogger('test');
    logger.info('hello', { key: 'value' });
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('info');
    expect(parsed.component).toBe('test');
    expect(parsed.msg).toBe('hello');
    expect(parsed.key).toBe('value');
  });

  it('respects log level', () => {
    const logger = createLogger('test', LogLevel.WARN);
    logger.info('should not appear');
    logger.warn('should appear');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('logs errors with stack', () => {
    const logger = createLogger('test');
    const err = new Error('boom');
    logger.error('failed', { error: err });
    const output = stderrSpy.mock.calls[0][0] as string;
    const parsed = JSON.parse(output);
    expect(parsed.level).toBe('error');
    expect(parsed.error).toContain('boom');
  });
});
