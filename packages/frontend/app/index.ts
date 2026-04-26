// ── Auth ────────────────────────────────────────────────────────────────────

export type Chain = 'base' | 'stellar';

export interface AuthState {
  address: string | null;
  chain: Chain | null;
  jwt: string | null;
  isAuthenticated: boolean;
}

// ── Feed ────────────────────────────────────────────────────────────────────

export interface TrendingCall {
  id: string;
  title: string;
  volume24h: number;
  trendingScore: number;
}