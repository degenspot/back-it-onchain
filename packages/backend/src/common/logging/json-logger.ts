import { LoggerService, LogLevel } from '@nestjs/common';

export class JsonLogger implements LoggerService {
  private context?: string;

  constructor(context?: string) {
    this.context = context;
  }

  private write(level: string, message: unknown, context?: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      context: context ?? this.context,
      message,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  log(message: unknown, context?: string): void {
    this.write('info', message, context);
  }

  error(message: unknown, trace?: string, context?: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      level: 'error',
      context: context ?? this.context,
      message,
      trace,
    };
    process.stdout.write(JSON.stringify(entry) + '\n');
  }

  warn(message: unknown, context?: string): void {
    this.write('warn', message, context);
  }

  debug(message: unknown, context?: string): void {
    this.write('debug', message, context);
  }

  verbose(message: unknown, context?: string): void {
    this.write('verbose', message, context);
  }

  setLogLevels(_levels: LogLevel[]): void {}
}