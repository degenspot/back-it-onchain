import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Call } from './call.entity';
import { Participant } from './participant.entity';
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
    @InjectRepository(Participant)
    private participantsRepository: Repository<Participant>,
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

  async getStakesByWallet(wallet: string): Promise<any[]> {
    const participants = await this.participantsRepository.find({
      where: { wallet },
      relations: ['call'],
    });

    const now = new Date();

    return participants.map((participant) => {
      const call = participant.call as Call;
      const isSettled = call.status === 'SETTLED' || call.outcome !== null;
      const hasEnded = new Date(call.endTs) <= now;

      // Determine status
      let status: 'active' | 'settled' | 'claimable' = 'active';
      if (isSettled) {
        if (participant.position === call.outcome) {
          status = 'claimable';
        } else {
          status = 'settled';
        }
      } else if (hasEnded) {
        status = 'settled';
      }

      // Calculate time left
      const timeLeft = hasEnded
        ? 'Ended'
        : getTimeRemaining(call.endTs);

      // Get call title from conditionJson or fallback
      const callTitle = call.conditionJson?.title || `Market #${call.id}`;

      // Calculate payout for winning stakes
      let payout: number | undefined;
      if (status === 'claimable') {
        const totalStakeYes = call.totalStakeYes || 0;
        const totalStakeNo = call.totalStakeNo || 0;
        const totalPool = totalStakeYes + totalStakeNo;
        const userStake = participant.amount;

        if (totalPool > 0) {
          const userSidePool = participant.position ? totalStakeYes : totalStakeNo;
          const losingPool = participant.position ? totalStakeNo : totalStakeYes;
          payout = userStake + (losingPool * (userStake / userSidePool));
        } else {
          payout = userStake;
        }
      }

      return {
        id: participant.id,
        callId: call.id,
        callTitle,
        choice: participant.position ? 'yes' : 'no',
        amount: participant.amount,
        chain: call.chain,
        timeLeft: status === 'active' ? timeLeft : undefined,
        status,
        payout,
        result: status === 'claimable' ? 'won' : status === 'settled' ? 'lost' : undefined,
      };
    });
  }
}

function getTimeRemaining(endTs: string | Date): string {
  try {
    const now = new Date();
    const end = new Date(endTs);
    const diff = Math.max(0, end.getTime() - now.getTime());

    if (diff === 0) return "Ended";

    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m`;

    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;

    const days = Math.floor(hrs / 24);
    return `${days}d`;
  } catch {
    return "TBD";
  }
}
