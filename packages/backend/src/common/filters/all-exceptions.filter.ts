import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Global exception filter that formats all errors as RFC 7807 Problem Details.
 *
 * Shape:
 * {
 *   "type":     "https://httpstatuses.com/400",
 *   "title":    "Bad Request",
 *   "status":   400,
 *   "detail":   "Validation failed: email must be an email",
 *   "instance": "/api/users"
 * }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let title: string;
    let detail: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        title = this.httpStatusTitle(status);
        detail = exceptionResponse;
      } else if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        const body = exceptionResponse as Record<string, unknown>;
        title = typeof body['error'] === 'string' ? body['error'] : this.httpStatusTitle(status);
        const message = body['message'];
        detail = Array.isArray(message)
          ? message.join('; ')
          : typeof message === 'string'
            ? message
            : exception.message;
      } else {
        title = this.httpStatusTitle(status);
        detail = exception.message;
      }
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      title = 'Internal Server Error';
      detail = 'An unexpected error occurred. Please try again later.';
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      type: `https://httpstatuses.com/${status}`,
      title,
      status,
      detail,
      instance: request.url,
    });
  }

  private httpStatusTitle(status: number): string {
    const titles: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      409: 'Conflict',
      410: 'Gone',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
    };
    return titles[status] ?? `HTTP Error ${status}`;
  }
}
