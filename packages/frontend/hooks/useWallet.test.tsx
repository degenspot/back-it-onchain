import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useWallet } from './useWallet';
import { useAccount } from 'wagmi';
import { useChain } from '@/components/ChainProvider';
import { useStellarWallet } from '@/components/StellarWalletProvider';

// Mock the hooks
vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
}));

vi.mock('@/components/ChainProvider', () => ({
  useChain: vi.fn(),
}));

vi.mock('@/components/StellarWalletProvider', () => ({
  useStellarWallet: vi.fn(),
}));

describe('useWallet', () => {
  it('should return stellar address when stellar chain is selected', () => {
    vi.mocked(useChain).mockReturnValue({ selectedChain: 'stellar' } as any);
    vi.mocked(useAccount).mockReturnValue({ address: '0xEVM', isConnected: false } as any);
    vi.mocked(useStellarWallet).mockReturnValue({ publicKey: 'GSTELLAR', isConnected: true } as any);

    const { result } = renderHook(() => useWallet());

    expect(result.current.address).toBe('GSTELLAR');
    expect(result.current.isConnected).toBe(true);
    expect(result.current.chainType).toBe('stellar');
  });

  it('should return evm address when base chain is selected', () => {
    vi.mocked(useChain).mockReturnValue({ selectedChain: 'base' } as any);
    vi.mocked(useAccount).mockReturnValue({ address: '0xEVM', isConnected: true } as any);
    vi.mocked(useStellarWallet).mockReturnValue({ publicKey: 'GSTELLAR', isConnected: false } as any);

    const { result } = renderHook(() => useWallet());

    expect(result.current.address).toBe('0xEVM');
    expect(result.current.isConnected).toBe(true);
    expect(result.current.chainType).toBe('base');
  });

  it('should return false for isConnected if respective wallet is not connected', () => {
    vi.mocked(useChain).mockReturnValue({ selectedChain: 'base' } as any);
    vi.mocked(useAccount).mockReturnValue({ address: undefined, isConnected: false } as any);
    vi.mocked(useStellarWallet).mockReturnValue({ publicKey: 'GSTELLAR', isConnected: true } as any);

    const { result } = renderHook(() => useWallet());

    expect(result.current.isConnected).toBe(false);
  });
});
