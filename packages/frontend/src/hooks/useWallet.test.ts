import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWallet } from './useWallet';

const tick = () => vi.advanceTimersByTimeAsync(600);

describe('useWallet Hook', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('should initialize with default states', () => {
    const { result } = renderHook(() => useWallet());
    
    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.chain).toBe('stellar');
    expect(result.current.status).toBe('disconnected');
    expect(result.current.chainId).toBeNull();
  });

  it('should connect to Base correctly', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWallet());
    
    const task = result.current.connect('base');
    await act(() => tick());
    await task;

    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe('0xMockAddress');
    expect(result.current.chain).toBe('base');
    expect(result.current.chainId).toBe(84532);
    expect(result.current.status).toBe('connected');
  });

  it('should connect to Stellar correctly', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWallet());
    
    const task = result.current.connect('stellar');
    await act(() => tick());
    await task;

    expect(result.current.isConnected).toBe(true);
    expect(result.current.address).toBe('GMockAddress');
    expect(result.current.chain).toBe('stellar');
    expect(result.current.chainId).toBeNull();
    expect(result.current.status).toBe('connected');
  });

  it('should disconnect correctly', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWallet());
    
    const connectTask = result.current.connect('base');
    await act(() => tick());
    await connectTask;

    expect(result.current.isConnected).toBe(true);

    act(() => {
      result.current.disconnect();
    });

    expect(result.current.isConnected).toBe(false);
    expect(result.current.address).toBeNull();
    expect(result.current.chainId).toBeNull();
    expect(result.current.status).toBe('disconnected');
  });

  it('should switch chains when connected', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useWallet());
    
    const connectTask = result.current.connect('base');
    await act(() => tick());
    await connectTask;

    expect(result.current.chain).toBe('base');

    const switchTask = result.current.switchChain('stellar');
    await act(() => tick());
    await switchTask;

    expect(result.current.chain).toBe('stellar');
    expect(result.current.isConnected).toBe(true);
    expect(result.current.status).toBe('connected');
  });
});