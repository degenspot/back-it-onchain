import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Call } from './call.entity';

@Injectable()
export class CallsService {
  constructor(
    @InjectRepository(Call)
    private callsRepository: Repository<Call>,
  ) { }

  async create(callData: Partial<Call>): Promise<Call> {
    const call = this.callsRepository.create(callData);
    return this.callsRepository.save(call);
  }

  async findAll(): Promise<Call[]> {
    return this.callsRepository.find({
      order: { createdAt: 'DESC' },
      relations: ['creator']
    });
  }

  async findOne(id: number): Promise<Call | null> {
    return this.callsRepository.findOne({ where: { id } });
  }

  async uploadIpfs(data: any): Promise<{ cid: string }> {
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');

    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const content = JSON.stringify(data);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const cid = `Qm${hash.substring(0, 44)}`; // Mock CID format

    fs.writeFileSync(path.join(uploadsDir, cid), content);
    return { cid };
  }

  async getIpfs(cid: string): Promise<any> {
    const fs = require('fs');
    const path = require('path');
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    const filePath = path.join(uploadsDir, cid);

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    }
    return null;
  }
}
