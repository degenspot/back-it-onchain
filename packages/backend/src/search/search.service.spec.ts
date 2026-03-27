import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SearchService } from './search.service';

// ---------------------------------------------------------------------------
// Fixture factories
// ---------------------------------------------------------------------------

const mockUserRow = (overrides = {}) => ({
  id: 'user-1',
  displayName: 'Alice',
  address: '0xALICE',
  avatar: 'https://avatar.url',
  ...overrides,
});

const mockCallRow = (overrides = {}) => ({
  id: 'call-1',
  title: 'BTC to 100k?',
  description: 'A prediction on Bitcoin',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

const mockTokenRow = (overrides = {}) => ({
  id: 'token-1',
  name: 'Bitcoin',
  symbol: 'BTC',
  address: '0xBTC',
  ...overrides,
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('SearchService', () => {
  let service: SearchService;
  let dataSource: { query: jest.Mock };

  beforeEach(async () => {
    dataSource = { query: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = module.get<SearchService>(SearchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Unified response shape
  // -------------------------------------------------------------------------
  describe('search — unified response format', () => {
    beforeEach(() => {
      // Default: one hit per category
      dataSource.query
        .mockResolvedValueOnce([mockUserRow()])   // users
        .mockResolvedValueOnce([mockCallRow()])   // calls
        .mockResolvedValueOnce([mockTokenRow()]); // tokens
    });

    it('returns users, calls, and tokens keys', async () => {
      const result = await service.search('bitcoin');

      expect(result).toHaveProperty('users');
      expect(result).toHaveProperty('calls');
      expect(result).toHaveProperty('tokens');
    });

    it('returns a meta object with query and total', async () => {
      const result = await service.search('bitcoin');

      expect(result.meta).toEqual({ query: 'bitcoin', total: 3 });
    });

    it('total equals sum of all category lengths', async () => {
      const result = await service.search('bitcoin');

      expect(result.meta.total).toBe(
        result.users.length + result.calls.length + result.tokens.length,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Query trimming / sanitisation
  // -------------------------------------------------------------------------
  describe('search — query sanitisation', () => {
    beforeEach(() => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
    });

    it('trims leading and trailing whitespace from the query', async () => {
      const result = await service.search('  bitcoin  ');

      expect(result.meta.query).toBe('bitcoin');
    });

    it('reflects the sanitised query in meta', async () => {
      const result = await service.search('   eth   ');

      expect(result.meta.query).toBe('eth');
    });
  });

  // -------------------------------------------------------------------------
  // Parallel execution
  // -------------------------------------------------------------------------
  describe('search — parallel data fetching', () => {
    it('executes all three queries concurrently (Promise.all)', async () => {
      const order: string[] = [];

      dataSource.query
        .mockImplementationOnce(async () => { order.push('users'); return []; })
        .mockImplementationOnce(async () => { order.push('calls'); return []; })
        .mockImplementationOnce(async () => { order.push('tokens'); return []; });

      await service.search('test');

      // All three queries must have been called
      expect(dataSource.query).toHaveBeenCalledTimes(3);
      expect(order).toEqual(expect.arrayContaining(['users', 'calls', 'tokens']));
    });
  });

  // -------------------------------------------------------------------------
  // User results
  // -------------------------------------------------------------------------
  describe('searchUsers result mapping', () => {
    beforeEach(() => {
      dataSource.query
        .mockResolvedValueOnce([
          mockUserRow({ id: 'u1', displayName: 'Alice', address: '0xA', avatar: 'https://a.png' }),
          mockUserRow({ id: 'u2', displayName: 'Bob',   address: '0xB', avatar: null }),
        ])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
    });

    it('maps all user fields correctly', async () => {
      const { users } = await service.search('alice');

      expect(users[0]).toEqual({
        id: 'u1',
        displayName: 'Alice',
        address: '0xA',
        avatar: 'https://a.png',
      });
    });

    it('coerces null avatar to null (not undefined)', async () => {
      const { users } = await service.search('alice');

      expect(users[1].avatar).toBeNull();
    });

    it('returns multiple user results', async () => {
      const { users } = await service.search('alice');

      expect(users).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Call results
  // -------------------------------------------------------------------------
  describe('searchCalls result mapping', () => {
    const callDate = new Date('2026-03-01');

    beforeEach(() => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          mockCallRow({ id: 'c1', title: 'BTC up?',  description: 'Bullish call', createdAt: callDate }),
          mockCallRow({ id: 'c2', title: 'ETH down?', description: 'Bearish call', createdAt: callDate }),
        ])
        .mockResolvedValueOnce([]);
    });

    it('maps all call fields correctly', async () => {
      const { calls } = await service.search('btc');

      expect(calls[0]).toEqual({
        id: 'c1',
        title: 'BTC up?',
        description: 'Bullish call',
        createdAt: callDate,
      });
    });

    it('returns multiple call results', async () => {
      const { calls } = await service.search('btc');

      expect(calls).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Token results
  // -------------------------------------------------------------------------
  describe('searchTokens result mapping', () => {
    beforeEach(() => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          mockTokenRow({ id: 't1', name: 'Bitcoin', symbol: 'BTC', address: '0xBTC' }),
          mockTokenRow({ id: 't2', name: 'Ethereum', symbol: 'ETH', address: '0xETH' }),
        ]);
    });

    it('maps all token fields correctly', async () => {
      const { tokens } = await service.search('bitcoin');

      expect(tokens[0]).toEqual({
        id: 't1',
        name: 'Bitcoin',
        symbol: 'BTC',
        address: '0xBTC',
      });
    });

    it('returns multiple token results', async () => {
      const { tokens } = await service.search('bitcoin');

      expect(tokens).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  // Empty results
  // -------------------------------------------------------------------------
  describe('search — empty results', () => {
    beforeEach(() => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
    });

    it('returns empty arrays for all categories when nothing matches', async () => {
      const result = await service.search('xyzzy_no_match');

      expect(result.users).toEqual([]);
      expect(result.calls).toEqual([]);
      expect(result.tokens).toEqual([]);
    });

    it('sets total to 0 when no results', async () => {
      const result = await service.search('xyzzy_no_match');

      expect(result.meta.total).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Mixed results (some categories empty, others not)
  // -------------------------------------------------------------------------
  describe('search — partial results', () => {
    it('counts correctly when only users match', async () => {
      dataSource.query
        .mockResolvedValueOnce([mockUserRow(), mockUserRow({ id: 'u2' })])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const result = await service.search('alice');

      expect(result.users).toHaveLength(2);
      expect(result.calls).toHaveLength(0);
      expect(result.tokens).toHaveLength(0);
      expect(result.meta.total).toBe(2);
    });

    it('counts correctly when only tokens match', async () => {
      dataSource.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockTokenRow(), mockTokenRow({ id: 't2' }), mockTokenRow({ id: 't3' })]);

      const result = await service.search('btc');

      expect(result.tokens).toHaveLength(3);
      expect(result.meta.total).toBe(3);
    });
  });

  // -------------------------------------------------------------------------
  // toTsQuery (via the public search method)
  // -------------------------------------------------------------------------
  describe('toTsQuery — query transformation', () => {
    beforeEach(() => {
      // Capture what's passed to dataSource.query for inspection
      dataSource.query.mockResolvedValue([]);
    });

    it('passes single-word query as-is to the SQL', async () => {
      await service.search('bitcoin');

      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1][0]).toBe('bitcoin');
    });

    it('joins multi-word query with & for full-text search', async () => {
      await service.search('bitcoin price prediction');

      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1][0]).toBe('bitcoin & price & prediction');
    });

    it('strips special characters from each word', async () => {
      await service.search('bit$coin eth!');

      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1][0]).toBe('bitcoin & eth');
    });

    it('passes ILIKE pattern with surrounding wildcards', async () => {
      await service.search('eth');

      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1][1]).toBe('%eth%');
    });

    it('handles extra internal whitespace between words', async () => {
      await service.search('btc   eth');

      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1][0]).toBe('btc & eth');
    });

    it('filters out words that become empty after stripping special chars', async () => {
      await service.search('!!! btc');

      const firstCall = dataSource.query.mock.calls[0];
      expect(firstCall[1][0]).toBe('btc');
    });
  });
});
