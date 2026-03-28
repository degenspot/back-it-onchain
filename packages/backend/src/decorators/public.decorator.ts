import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../common/guards/jwt-auth.guard';

/**
 * Mark a controller or route handler as publicly accessible —
 * the JwtAuthGuard will skip authentication for decorated routes.
 *
 * @example
 * @Public()
 * @Get('nonce')
 * getNonce() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
