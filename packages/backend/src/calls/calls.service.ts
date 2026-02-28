import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Call } from './call.entity';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

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

  async findAll(options?: { chain?: 'base' | 'stellar' }): Promise<Call[]> {
    const where = options?.chain ? { chain: options.chain } : {};
    return this.callsRepository.find({
      where,
      order: { createdAt: 'DESC' },
      relations: ['creator'],
    });
  }

  async findOne(id: number): Promise<Call | null> {
    return this.callsRepository.findOne({ where: { id } });
  }

  async report(id: number, reason: string): Promise<{ success: boolean; message: string }> {
    // Standard implementation for logging reports against an ID without a dedicated Database Table
    console.log(`[Report Received] Call ID: ${id} | Reason: ${reason}`);
    return { success: true, message: 'Report submitted successfully' };
  }

  async uploadIpfs(data: any): Promise<{ cid: string }> {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const content = JSON.stringify(data);
    const hash = crypto.createHash('sha256').update(content).digest('hex');
    const cid = `Qm${hash.substring(0, 44)} `; // Mock CID format

    fs.writeFileSync(path.join(uploadsDir, cid), content);
    return Promise.resolve({ cid });
  }

  async getIpfs(cid: string): Promise<any> {
    const uploadsDir = path.join(__dirname, '..', '..', 'uploads');
    const filePath = path.join(uploadsDir, cid);

    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8');
      return Promise.resolve(JSON.parse(content));
    }
    return Promise.resolve(null);
  }
}
