'use client';

import { useAccount, useSwitchChain } from 'wagmi';
import { useEffect } from 'react';
import { useChain } from './ChainProvider';

// Expected chain ID for local development
const EXPECTED_CHAIN_ID = 31337; // Anvil localhost

export function NetworkGuard({ children }: { children: React.ReactNode }) {
    const { isConnected, chain } = useAccount();
    const { switchChain, isPending, error } = useSwitchChain();
    const { selectedChain } = useChain();
    
    // Only enforce EVM network if we are on the Base/EVM chain
    const isWrongNetwork = selectedChain === 'base' && isConnected && chain && chain.id !== EXPECTED_CHAIN_ID;

    // Auto-switch effect
    useEffect(() => {
        if (isWrongNetwork) {
            switchChain({ chainId: EXPECTED_CHAIN_ID });
        }
    }, [isWrongNetwork, switchChain]);

    const handleSwitch = () => {
        switchChain({ chainId: EXPECTED_CHAIN_ID });
    };

    if (isWrongNetwork) {
        return (
            <div className="min-h-screen bg-background">
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-card border border-border rounded-2xl p-6 max-w-md w-full shadow-2xl">
                        <div className="text-center">
                            <div className="w-16 h-16 bg-yellow-500/20 rounded-full flex items-center justify-center mx-auto mb-4">
                                <svg className="w-8 h-8 text-yellow-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-bold mb-2">Wrong Network</h2>
                            <p className="text-muted-foreground mb-6">
                                Please switch to the <span className="font-semibold text-primary">Localhost (Anvil)</span> network to use this app.
                            </p>
                            <button
                                onClick={handleSwitch}
                                disabled={isPending}
                                className="w-full py-3 px-4 bg-primary text-primary-foreground rounded-xl font-bold hover:bg-primary/90 transition-colors disabled:opacity-50"
                            >
                                {isPending ? 'Switching...' : 'Switch Network'}
                            </button>
                            {error && (
                                <p className="mt-4 text-sm text-red-500">
                                    Failed to switch. Please add the network manually:
                                    <br />
                                    <span className="font-mono text-xs">RPC: http://127.0.0.1:8545, Chain ID: 31337</span>
                                </p>
                            )}
                        </div>
                    </div>
                </div>
                {children}
            </div>
        );
    }

    return <>{children}</>;
}
