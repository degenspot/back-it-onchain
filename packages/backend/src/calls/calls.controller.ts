import { Controller, Get, Post, Body, Param, Query } from '@nestjs/common';
import { CallsService } from './calls.service';
import { Call } from './call.entity';

@Controller('calls')
export class CallsController {
  constructor(private readonly callsService: CallsService) { }

  @Post()
  create(@Body() createCallDto: Partial<Call>) {
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
  report(@Param('id') id: string, @Body('reason') reason: string) {
    return this.callsService.report(+id, reason);
  }

  @Post('ipfs')
  uploadIpfs(@Body() body: any) {
    return this.callsService.uploadIpfs(body);
  }

  @Get('ipfs/:cid')
  getIpfs(@Param('cid') cid: string) {
    return this.callsService.getIpfs(cid);
  }
}
