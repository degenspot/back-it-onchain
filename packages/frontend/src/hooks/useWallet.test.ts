import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useWallet } from './useWallet';

// Mock dependencies (e.g., OnchainKit and Freighter)
vi.mock('@coinbase/onchainkit', () => ({
  // Mock implementations
}));
vi.mock('@stellar/freighter-api', () => ({
  // Mock implementations
}));

describe('useWallet Hook', () => {
  it('should initialize with default states', () => {
    const { result } = renderHook(() => useWallet());
    
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.chainType).toBeNull();
  });

  it('should connect to Base correctly', async () => {
    const { result } = renderHook(() => useWallet());
    
    await act(async () => {
      await result.current.connectBase();
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe('0xBaseAddress');
    expect(result.current.chainType).toBe('base');
  });

  it('should connect to Stellar correctly', async () => {
    const { result } = renderHook(() => useWallet());
    
    await act(async () => {
      await result.current.connectStellar();
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe('GStellarAddress');
    expect(result.current.chainType).toBe('stellar');
  });

  it('should disconnect correctly', async () => {
    const { result } = renderHook(() => useWallet());
    
    await act(async () => {
      await result.current.connectBase();
    });

    expect(result.current.isConnected).toBe(true);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.chainType).toBeNull();
  });
});
