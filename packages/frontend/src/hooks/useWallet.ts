import { useState, useCallback } from 'react';

export type ChainType = 'base' | 'stellar' | null;

export function useWallet() {
  const [isConnected, setIsConnected] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [chainType, setChainType] = useState<ChainType>(null);

  const connectBase = useCallback(async () => {
    // Abstraction layer over OnchainKit / wagmi
    setIsConnected(true);
    setAddress('0xBaseAddress');
    setChainType('base');
  }, []);

  const connectStellar = useCallback(async () => {
    // Abstraction layer over Freighter
    setIsConnected(true);
    setAddress('GStellarAddress');
    setChainType('stellar');
  }, []);

  const disconnect = useCallback(() => {
    setIsConnected(false);
    setAddress(null);
    setChainType(null);
  }, []);

  return {
    isConnected,
    address,
    chainType,
    connectBase,
    connectStellar,
    disconnect,
  };
}
