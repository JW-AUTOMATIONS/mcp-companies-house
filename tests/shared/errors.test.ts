import { describe, it, expect } from 'vitest';
import {
  ChMcpError,
  CompanyNotFoundError,
  InvalidInputError,
  RateLimitedError,
  ApiUnavailableError,
  ProRequiredError,
  ErrorCode,
} from '../../src/shared/errors.js';

describe('ChMcpError', () => {
  it('creates error with code and message', () => {
    const err = new ChMcpError(ErrorCode.COMPANY_NOT_FOUND, 'Not found');
    expect(err.code).toBe('COMPANY_NOT_FOUND');
    expect(err.message).toBe('Not found');
    expect(err).toBeInstanceOf(Error);
  });

  it('toMcpError returns structured content', () => {
    const err = new ChMcpError(ErrorCode.INVALID_INPUT, 'Bad number');
    const result = err.toMcpError();
    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.code).toBe('INVALID_INPUT');
    expect(parsed.message).toBe('Bad number');
  });
});

describe('factory errors', () => {
  it('CompanyNotFoundError has correct code', () => {
    const err = new CompanyNotFoundError('12345678');
    expect(err.code).toBe('COMPANY_NOT_FOUND');
    expect(err.message).toContain('12345678');
  });

  it('InvalidInputError has correct code', () => {
    const err = new InvalidInputError('Company number must be 8 digits');
    expect(err.code).toBe('INVALID_INPUT');
  });

  it('RateLimitedError has correct code', () => {
    const err = new RateLimitedError();
    expect(err.code).toBe('RATE_LIMITED');
  });

  it('ApiUnavailableError has correct code', () => {
    const err = new ApiUnavailableError();
    expect(err.code).toBe('API_UNAVAILABLE');
  });

  it('ProRequiredError includes signup info', () => {
    const err = new ProRequiredError('monitor_company');
    expect(err.code).toBe('PRO_REQUIRED');
    expect(err.message).toContain('monitor_company');
  });
});
