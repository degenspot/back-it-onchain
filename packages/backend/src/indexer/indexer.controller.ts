import { Controller, Get } from '@nestjs/common';
import { IndexerService } from './indexer.service';

@Controller('config')
export class IndexerController {
    constructor(private readonly indexerService: IndexerService) { }

    @Get()
    async getConfig() {
        return this.indexerService.getPlatformSettings();
    }
}
