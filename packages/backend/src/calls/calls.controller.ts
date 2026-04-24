import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CallsService } from './calls.service';
import { Call } from './call.entity';
import { AdminService } from '../admin/admin.service';

@Controller('calls')
export class CallsController {
  constructor(
    private readonly callsService: CallsService,
    private readonly adminService: AdminService,
  ) {}

  @Throttle({ short: { limit: 5, ttl: 1 * 60000 } })
  @Post()
  create(@Body() createCallDto: Partial<Call>) {
    if (this.adminService.isPaused()) {
      throw new ServiceUnavailableException(
        'Protocol is paused. New call creation is disabled.',
      );
    }
    return this.callsService.create(createCallDto);
  }

  @Get()
  findAll(@Query('chain') chain?: 'base' | 'stellar') {
    return this.callsService.findAll({ chain });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.callsService.findOne(+id);
  }

  @Post(':id/report')
  report(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    const wallet = req.user?.wallet || req.headers['x-user-wallet'];
    if (!wallet) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }
    return this.callsService.report(+id, reason);
  }

  @Throttle({ default: { limit: 10, ttl: 1 * 60000 } })
  @Post('ipfs')
  uploadIpfs(@Body() body: any) {
    return this.callsService.uploadIpfs(body);
  }

  @Get('ipfs/:cid')
  getIpfs(@Param('cid') cid: string) {
    return this.callsService.getIpfs(cid);
  }
}
