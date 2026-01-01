import { Controller, Get, Post, Body, Param } from '@nestjs/common';
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
  findAll() {
    return this.callsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.callsService.findOne(+id);
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
