import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AdminGuard } from '../common/guards/admin.guard';
import { AdminService } from './admin.service';

class CircuitBreakerDto {
  paused!: boolean;
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * PATCH /admin/circuit-breaker
   *
   * Toggle the protocol-wide circuit breaker.
   * Requires `x-admin-api-key` header matching the `ADMIN_API_KEY` env var.
   *
   * Body: { "paused": true | false }
   */
  @Patch('circuit-breaker')
  @HttpCode(HttpStatus.OK)
  async setCircuitBreaker(
    @Body() body: CircuitBreakerDto,
  ): Promise<{ isPaused: boolean; updatedAt: Date }> {
    return this.adminService.setCircuitBreaker(Boolean(body.paused));
  }
}
