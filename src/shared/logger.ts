export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'debug',
  [LogLevel.INFO]: 'info',
  [LogLevel.WARN]: 'warn',
  [LogLevel.ERROR]: 'error',
};

export interface Logger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
}

export function createLogger(component: string, minLevel: LogLevel = LogLevel.INFO): Logger {
  function log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (level < minLevel) return;

    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level: LEVEL_NAMES[level],
      component,
      msg,
    };

    if (data) {
      for (const [key, value] of Object.entries(data)) {
        if (value instanceof Error) {
          entry[key] = value.stack ?? value.message;
        } else {
          entry[key] = value;
        }
      }
    }

    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  return {
    debug: (msg, data) => log(LogLevel.DEBUG, msg, data),
    info: (msg, data) => log(LogLevel.INFO, msg, data),
    warn: (msg, data) => log(LogLevel.WARN, msg, data),
    error: (msg, data) => log(LogLevel.ERROR, msg, data),
  };
}
