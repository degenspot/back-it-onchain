import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class SearchQueryDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  q: string;
}

export class UserSearchResult {
  id: string;
  displayName: string;
  address: string;
  avatar?: string;
}

export class CallSearchResult {
  id: string;
  title: string;
  description: string;
  createdAt: Date;
}

export class TokenSearchResult {
  id: string;
  name: string;
  symbol: string;
  address: string;
}

export class SearchResponseDto {
  users: UserSearchResult[];
  calls: CallSearchResult[];
  tokens: TokenSearchResult[];
  meta: {
    query: string;
    total: number;
  };
}
