import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Call } from '../calls/call.entity';

@Injectable()
export class IndexerService implements OnModuleInit {
  private provider: ethers.JsonRpcProvider;
  private registryAddress: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Call)
    private callsRepository: Repository<Call>,
  ) {
    const rpcUrl = this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
    this.registryAddress = this.configService.get<string>('CALL_REGISTRY_ADDRESS') || '';

    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  onModuleInit() {
    if (this.provider && this.registryAddress) {
      this.startListening();
    }
  }

  startListening() {
    console.log('Starting indexer on ' + this.registryAddress);

    const abi = [
      "event CallCreated(uint256 indexed callId, address indexed creator, address stakeToken, uint256 stakeAmount, uint256 startTs, uint256 endTs, address tokenAddress, bytes32 pairId, string ipfsCID)",
      "event StakeAdded(uint256 indexed callId, address indexed staker, bool position, uint256 amount)"
    ];

    const contract = new ethers.Contract(this.registryAddress, abi, this.provider);

    contract.on("CallCreated", async (callId, creator, stakeToken, stakeAmount, startTs, endTs, tokenAddress, pairId, ipfsCID, event) => {
      console.log(`New Call Created: ${callId}`);

      const call = this.callsRepository.create({
        callOnchainId: callId.toString(),
        creatorWallet: creator,
        stakeToken,
        totalStakeYes: Number(ethers.formatUnits(stakeAmount, 18)), // Assuming 18 decimals for now
        totalStakeNo: 0,
        startTs: new Date(Number(startTs) * 1000),
        endTs: new Date(Number(endTs) * 1000),
        tokenAddress,
        pairId,
        ipfsCid: ipfsCID,
        status: 'active'
      });

      await this.callsRepository.save(call);
    });

    contract.on("StakeAdded", async (callId, staker, position, amount, event) => {
      console.log(`Stake Added to Call ${callId}: ${amount} on ${position ? 'YES' : 'NO'}`);

      const call = await this.callsRepository.findOne({ where: { callOnchainId: callId.toString() } });
      if (call) {
        const amountNum = Number(ethers.formatUnits(amount, 18));
        if (position) {
          call.totalStakeYes = Number(call.totalStakeYes) + amountNum;
        } else {
          call.totalStakeNo = Number(call.totalStakeNo) + amountNum;
        }
        await this.callsRepository.save(call);
      }
    });
  }
}
