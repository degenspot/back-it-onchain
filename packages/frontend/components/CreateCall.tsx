'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';

export function CreateCall() {
    const { address } = useAccount();
    const [token, setToken] = useState('');
    const [amount, setAmount] = useState('');
    const [targetPrice, setTargetPrice] = useState('');
    const [endDate, setEndDate] = useState('');

    const handleCreate = async () => {
        if (!address) return;

        // Placeholder for contract interaction
        // In a real app, we would call the CallRegistry contract
        console.log('Creating call...', { token, amount, targetPrice, endDate });

        // Mock backend call
        await fetch('http://localhost:3001/calls', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                creatorWallet: address,
                tokenAddress: token,
                stakeAmount: amount,
                endTs: new Date(endDate).toISOString(),
                conditionJson: { targetPrice },
            }),
        });
    };

    return (
        <div className="p-6 bg-white rounded-xl shadow-lg max-w-md mx-auto">
            <h2 className="text-2xl font-bold mb-4">Create a Call</h2>
            <div className="space-y-4">
                <div>
                    <label htmlFor="cc-token" className="block text-sm font-medium text-gray-700">Token Address</label>
                    <input
                        id="cc-token"
                        type="text"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                        value={token}
                        onChange={(e) => setToken(e.target.value)}
                        placeholder="0x..."
                    />
                </div>
                <div>
                    <label htmlFor="cc-amount" className="block text-sm font-medium text-gray-700">Stake Amount (USDC)</label>
                    <input
                        id="cc-amount"
                        type="number"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="100"
                    />
                </div>
                <div>
                    <label htmlFor="cc-target" className="block text-sm font-medium text-gray-700">Target Price ($)</label>
                    <input
                        id="cc-target"
                        type="number"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                        value={targetPrice}
                        onChange={(e) => setTargetPrice(e.target.value)}
                        placeholder="2000"
                    />
                </div>
                <div>
                    <label htmlFor="cc-enddate" className="block text-sm font-medium text-gray-700">End Date</label>
                    <input
                        id="cc-enddate"
                        type="datetime-local"
                        className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm p-2 border"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                    />
                </div>
                <button
                    onClick={handleCreate}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                >
                    Create Call
                </button>
            </div>
        </div>
    );
}
