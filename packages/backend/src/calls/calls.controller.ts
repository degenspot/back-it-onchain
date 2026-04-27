import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CallsService } from './calls.service';
import { Call } from './call.entity';
import { AdminService } from '../admin/admin.service';
import { CallsQueryDto } from './dto/calls-query.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

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
  findAll(@Query() query: CallsQueryDto) {
    return this.callsService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.callsService.findOne(+id);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':id/report')
  report(
    @Param('id') id: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    const wallet: string = req.user.wallet;
    return this.callsService.report(+id, reason, wallet);
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
