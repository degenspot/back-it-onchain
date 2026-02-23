import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { LeaderboardService } from './leaderboard.service';
import { Leaderboard } from './entities/leaderboard.entity';

describe('LeaderboardService', () => {
  let service: LeaderboardService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        LeaderboardService,
        {
          provide: getRepositoryToken(Leaderboard),
          useValue: {
            find: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<LeaderboardService>(LeaderboardService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});

