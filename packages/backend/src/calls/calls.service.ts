import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Call } from './call.entity';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

type CallsListOptions = {
  chain?: 'base' | 'stellar';
  limit: number;
  offset: number;
};

type CallsListResponse = {
  data: Call[];
  meta: {
    total: number;
    limit: number;
    offset: number;
  };
};

type CallResponse = {
  data: Call;
  meta: null;
};

@Injectable()
export class CallsService {
  constructor(
    @InjectRepository(Call)
    private callsRepository: Repository<Call>,
  ) {}

  async create(callData: Partial<Call>): Promise<Call> {
    const call = this.callsRepository.create(callData);
    return this.callsRepository.save(call);
  }

  async findAll(options: CallsListOptions): Promise<CallsListResponse> {
    const where: any = { isHidden: false };
    if (options.chain) {
      where.chain = options.chain;
    }

    const [data, total] = await this.callsRepository.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      relations: ['creator'],
      take: options.limit,
      skip: options.offset,
    });

    return {
      data,
      meta: {
        total,
        limit: options.limit,
        offset: options.offset,
      },
    };
  }

  async findOne(id: number): Promise<CallResponse> {
    const call = await this.callsRepository.findOne({
      where: { id },
      relations: ['creator'],
    });

    if (!call) {
      throw new NotFoundException('Call not found');
    }

    return {
      data: call,
      meta: null,
    };
  }

  async report(
    id: number,
    reason: string,
  ): Promise<{ success: boolean; message: string }> {
    const call = await this.callsRepository.findOne({ where: { id } });
    if (!call) {
      throw new NotFoundException('Call not found');
    }

    call.reportCount += 1;
    if (call.reportCount >= 5) {
      call.isHidden = true;
    }

    await this.callsRepository.save(call);

    console.log(
      `[Report Received] Call ID: ${id} | Reason: ${reason} | Report Count: ${call.reportCount}`,
    );
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
