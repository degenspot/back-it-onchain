import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/**
 * Protects admin-only routes by requiring the caller to supply a valid
 * API key in the `x-admin-api-key` header.
 *
 * Configure the secret via the `ADMIN_API_KEY` environment variable.
 * If the variable is not set, all admin requests are rejected (fail-safe).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const adminKey = this.configService.get<string>('ADMIN_API_KEY');

    if (!adminKey) {
      throw new ForbiddenException('Admin access not configured');
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-admin-api-key'];

    if (!provided || provided !== adminKey) {
      throw new UnauthorizedException('Invalid or missing admin API key');
    }

    return true;
  }
}
