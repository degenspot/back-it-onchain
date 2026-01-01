import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ethers } from 'ethers';
import { Call } from '../calls/call.entity';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class IndexerService implements OnModuleInit {
  private provider: ethers.JsonRpcProvider;
  private registryAddress: string;

  constructor(
    private configService: ConfigService,
    @InjectRepository(Call)
    private callsRepository: Repository<Call>,
    private authService: AuthService,
  ) {
    const rpcUrl = this.configService.get<string>('BASE_SEPOLIA_RPC_URL');
    this.registryAddress = this.configService.get<string>('CALL_REGISTRY_ADDRESS') || '';

    if (rpcUrl) {
      this.provider = new ethers.JsonRpcProvider(rpcUrl);
    }
  }

  async onModuleInit() {
    if (this.provider && this.registryAddress) {
      const network = await this.provider.getNetwork();
      const blockNumber = await this.provider.getBlockNumber();
      console.log(`[Indexer Debug] Connected to Chain ID: ${network.chainId}`);
      console.log(`[Indexer Debug] Current Block: ${blockNumber}`);
      console.log(`[Indexer Debug] RPC URL: ${this.configService.get<string>('BASE_SEPOLIA_RPC_URL')}`);

      await this.syncHistoricalEvents();
      this.startListening();
    }
  }

  async syncHistoricalEvents() {
    console.log('Syncing historical events...');
    const abi = [
      "event CallCreated(uint256 indexed callId, address indexed creator, address stakeToken, uint256 stakeAmount, uint256 startTs, uint256 endTs, address tokenAddress, bytes32 pairId, string ipfsCID)",
      "event StakeAdded(uint256 indexed callId, address indexed staker, bool position, uint256 amount)"
    ];
    const contract = new ethers.Contract(this.registryAddress, abi, this.provider);

    try {
      const currentBlock = await this.provider.getBlockNumber();
      const callCreatedEvents = await contract.queryFilter("CallCreated", 0, currentBlock);
      const stakeAddedEvents = await contract.queryFilter("StakeAdded", 0, currentBlock);

      console.log(`Found ${callCreatedEvents.length} historical CallCreated events and ${stakeAddedEvents.length} StakeAdded events.`);

      for (const event of callCreatedEvents) {
        if ('args' in event && event.args) {
          const args = event.args;
          await this.handleCallCreated(args[0], args[1], args[2], args[3], args[4], args[5], args[6], args[7], args[8]);
        }
      }

      for (const event of stakeAddedEvents) {
        if ('args' in event && event.args) {
          const args = event.args;
          await this.handleStakeAdded(args[0], args[1], args[2], args[3]);
        }
      }
    } catch (error) {
      console.error('Error syncing historical events:', error);
    }
  }

  async handleCallCreated(callId: any, creator: any, stakeToken: any, stakeAmount: any, startTs: any, endTs: any, tokenAddress: any, pairId: any, ipfsCID: any) {
    const existing = await this.callsRepository.findOne({ where: { callOnchainId: callId.toString() } });
    if (existing) return;

    console.log(`Processing CallCreated: ${callId} by ${creator}`);
    await this.authService.validateUser(creator);

    let conditionJson = {};
    if (ipfsCID && ipfsCID.length > 0) {
      try {
        conditionJson = await this.fetchIpfsData(ipfsCID);
      } catch (e) {
        console.error(`Failed to fetch IPFS data for ${ipfsCID}:`, e);
      }
    }

    const call = this.callsRepository.create({
      callOnchainId: callId.toString(),
      creatorWallet: creator,
      stakeToken,
      totalStakeYes: Number(ethers.formatUnits(stakeAmount, 18)),
      totalStakeNo: 0,
      startTs: new Date(Number(startTs) * 1000),
      endTs: new Date(Number(endTs) * 1000),
      tokenAddress,
      pairId,
      ipfsCid: ipfsCID,
      conditionJson,
      status: 'active'
    });

    await this.callsRepository.save(call);
  }

  async fetchIpfsData(cid: string): Promise<any> {
    if (cid === 'QmMockCID') {
      return {
        title: 'ETH will flip BTC',
        thesis: 'Ethereum has better fundamentals and yielding properties than Bitcoin.',
        target: '0.06 BTC',
        deadline: '2026-01-01'
      };
    }

    const gateways = [
      `http://localhost:3001/calls/ipfs/${cid}`,
      `https://gateway.pinata.cloud/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
      `https://dweb.link/ipfs/${cid}`
    ];

    for (const url of gateways) {
      try {
        const response = await fetch(url);
        if (response.ok) {
          return await response.json();
        }
      } catch (error) {
        continue;
      }
    }
    return {};
  }

  async handleStakeAdded(callId: any, staker: any, position: any, amount: any) {
    console.log(`Processing StakeAdded to Call ${callId}: ${amount} on ${position ? 'YES' : 'NO'}`);
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
  }

  startListening() {
    console.log('Starting indexer on ' + this.registryAddress);

    const abi = [
      "event CallCreated(uint256 indexed callId, address indexed creator, address stakeToken, uint256 stakeAmount, uint256 startTs, uint256 endTs, address tokenAddress, bytes32 pairId, string ipfsCID)",
      "event StakeAdded(uint256 indexed callId, address indexed staker, bool position, uint256 amount)"
    ];

    const contract = new ethers.Contract(this.registryAddress, abi, this.provider);

    contract.on("CallCreated", (callId, creator, stakeToken, stakeAmount, startTs, endTs, tokenAddress, pairId, ipfsCID) =>
      this.handleCallCreated(callId, creator, stakeToken, stakeAmount, startTs, endTs, tokenAddress, pairId, ipfsCID)
    );
    contract.on("StakeAdded", (callId, staker, position, amount) =>
      this.handleStakeAdded(callId, staker, position, amount)
    );
  }
}
