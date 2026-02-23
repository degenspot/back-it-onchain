import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  SearchResponseDto,
  UserSearchResult,
  CallSearchResult,
  TokenSearchResult,
} from './dto/search.dto';

@Injectable()
export class SearchService {
  constructor(private readonly dataSource: DataSource) {}

  async search(query: string): Promise<SearchResponseDto> {
    const sanitized = query.trim();

    const [users, calls, tokens] = await Promise.all([
      this.searchUsers(sanitized),
      this.searchCalls(sanitized),
      this.searchTokens(sanitized),
    ]);

    return {
      users,
      calls,
      tokens,
      meta: {
        query: sanitized,
        total: users.length + calls.length + tokens.length,
      },
    };
  }

  private async searchUsers(query: string): Promise<UserSearchResult[]> {
    const tsQuery = this.toTsQuery(query);

    const results = await this.dataSource.query(
      `
      SELECT
        u.id,
        u."displayName",
        u.address,
        u.avatar
      FROM "user" u
      WHERE
        to_tsvector('english', coalesce(u."displayName", '') || ' ' || coalesce(u.address, ''))
          @@ plainto_tsquery('english', $1)
        OR u."displayName" ILIKE $2
        OR u.address ILIKE $2
      ORDER BY
        ts_rank(
          to_tsvector('english', coalesce(u."displayName", '') || ' ' || coalesce(u.address, '')),
          plainto_tsquery('english', $1)
        ) DESC
      LIMIT 10
      `,
      [tsQuery, `%${query}%`],
    );

    return results.map((r: any) => ({
      id: r.id,
      displayName: r.displayName,
      address: r.address,
      avatar: r.avatar ?? null,
    }));
  }

  private async searchCalls(query: string): Promise<CallSearchResult[]> {
    const tsQuery = this.toTsQuery(query);

    const results = await this.dataSource.query(
      `
      SELECT
        c.id,
        c.title,
        c.description,
        c."createdAt"
      FROM "call" c
      WHERE
        to_tsvector('english', coalesce(c.title, '') || ' ' || coalesce(c.description, ''))
          @@ plainto_tsquery('english', $1)
        OR c.title ILIKE $2
        OR c.description ILIKE $2
      ORDER BY
        ts_rank(
          to_tsvector('english', coalesce(c.title, '') || ' ' || coalesce(c.description, '')),
          plainto_tsquery('english', $1)
        ) DESC
      LIMIT 10
      `,
      [tsQuery, `%${query}%`],
    );

    return results.map((r: any) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      createdAt: r.createdAt,
    }));
  }

  private async searchTokens(query: string): Promise<TokenSearchResult[]> {
    const tsQuery = this.toTsQuery(query);

    const results = await this.dataSource.query(
      `
      SELECT
        t.id,
        t.name,
        t.symbol,
        t.address
      FROM "token" t
      WHERE
        to_tsvector('english', coalesce(t.name, '') || ' ' || coalesce(t.symbol, ''))
          @@ plainto_tsquery('english', $1)
        OR t.name ILIKE $2
        OR t.symbol ILIKE $2
        OR t.address ILIKE $2
      ORDER BY
        ts_rank(
          to_tsvector('english', coalesce(t.name, '') || ' ' || coalesce(t.symbol, '')),
          plainto_tsquery('english', $1)
        ) DESC
      LIMIT 10
      `,
      [tsQuery, `%${query}%`],
    );

    return results.map((r: any) => ({
      id: r.id,
      name: r.name,
      symbol: r.symbol,
      address: r.address,
    }));
  }

  private toTsQuery(query: string): string {
    return query
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word.replace(/[^a-zA-Z0-9]/g, ''))
      .filter(Boolean)
      .join(' & ');
  }
}
