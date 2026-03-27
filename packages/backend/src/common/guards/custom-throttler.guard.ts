import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected generateKey(context: ExecutionContext, trackerString: string, throttlerName: string): string {
    const req = context.switchToHttp().getRequest();
    const tracker = req.user?.id || req.user?.wallet || req.headers['x-user-wallet'] || req.ip;
    return `${throttlerName}:${tracker}`;
  }

  // Fallback for older throttler versions or specific internal uses
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return req.user?.id || req.user?.wallet || req.headers['x-user-wallet'] || req.ip;
  }
}
