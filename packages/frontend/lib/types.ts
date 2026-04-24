export interface User {
  wallet: string;
  displayName?: string;
  handle?: string;
  bio?: string;
  avatarCid?: string;
  referredBy?: string;
  avatar?: string; // Legacy UI
  isFollowing?: boolean;
  createdAt?: string;
}

export interface Call {
  id: string | number; // callOnchainId or internal ID
  title?: string;
  thesis?: string;
  asset?: string;
  target?: string;
  deadline?: string;
  stake?: string;
  creator?: User;
  status?: string | number;
  createdAt?: string;
  backers?: number;
  comments?: number;
  volume?: string;
  totalStakeYes?: number | string;
  totalStakeNo?: number | string;
  stakeToken?: string;
  endTs?: string | number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  conditionJson?: any;
  chain?: "base" | "stellar";
  creatorWallet?: string;
  pairId?: string;
  callOnchainId?: string;
  tokenAddress?: string;
  stakeAmount?: string;
  targetPrice?: string;
}
