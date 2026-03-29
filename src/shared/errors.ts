export enum ErrorCode {
  COMPANY_NOT_FOUND = 'COMPANY_NOT_FOUND',
  INVALID_INPUT = 'INVALID_INPUT',
  RATE_LIMITED = 'RATE_LIMITED',
  API_UNAVAILABLE = 'API_UNAVAILABLE',
  PRO_REQUIRED = 'PRO_REQUIRED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export interface McpErrorResponse {
  isError: true;
  content: Array<{ type: 'text'; text: string }>;
}

export class ChMcpError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'ChMcpError';
  }

  toMcpError(): McpErrorResponse {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({ code: this.code, message: this.message }),
        },
      ],
    };
  }
}

export class CompanyNotFoundError extends ChMcpError {
  constructor(companyNumber: string) {
    super(
      ErrorCode.COMPANY_NOT_FOUND,
      `Company ${companyNumber} not found. Verify the 8-digit company number.`
    );
  }
}

export class InvalidInputError extends ChMcpError {
  constructor(detail: string) {
    super(ErrorCode.INVALID_INPUT, detail);
  }
}

export class RateLimitedError extends ChMcpError {
  constructor() {
    super(
      ErrorCode.RATE_LIMITED,
      'Companies House API rate limit reached. Try again in 30 seconds.'
    );
  }
}

export class ApiUnavailableError extends ChMcpError {
  constructor() {
    super(
      ErrorCode.API_UNAVAILABLE,
      'Companies House API is temporarily unavailable. Cached data may be served.'
    );
  }
}

export class ProRequiredError extends ChMcpError {
  constructor(toolName: string) {
    super(
      ErrorCode.PRO_REQUIRED,
      `${toolName} requires a Pro subscription. Visit https://passiveinc.dev/pro to subscribe.`
    );
  }
}
