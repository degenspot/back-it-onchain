"use client";

import { cn } from "@/lib/utils";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from 'next/navigation';
import { User, CheckCircle2, ArrowRight, Loader2 } from 'lucide-react';
import { Logo } from "@/components/logo";
import {
    ConnectWallet,
    Wallet as OnchainKitWallet,
} from '@coinbase/onchainkit/wallet';
import {
    Avatar,
    Name,
} from '@coinbase/onchainkit/identity';
import { useAccount } from 'wagmi';
import { useGlobalState } from "@/components/GlobalState";
import { useChain } from "@/components/ChainProvider";
import { useStellarWallet } from "@/components/StellarWalletProvider";

export default function OnboardingPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen flex items-center justify-center">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            }
        >
            <OnboardingContent />
        </Suspense>
    );
}

function OnboardingContent() {
    const [step, setStep] = useState(1);
    const router = useRouter();
    const searchParams = useSearchParams();
    const { updateProfile, isLoading, currentUser, setPendingReferrerWallet } = useGlobalState();

    // Chain selection
    const { selectedChain, setSelectedChain, isChainLoaded } = useChain();

    // EVM wallet (Base)
    const { isConnected: isEvmConnected } = useAccount();

    // Stellar wallet (Freighter)
    const {
        isConnected: isStellarConnected,
        isFreighterInstalled,
        isFreighterCheckComplete,
        connect: connectStellar,
        isConnecting: isStellarConnecting,
        publicKey: stellarAddress,
    } = useStellarWallet();

    // Determine if wallet is connected based on selected chain
    const isWalletConnected = selectedChain === 'stellar' ? isStellarConnected : isEvmConnected;

    const [username, setUsername] = useState("");
    const [bio, setBio] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Auto-advance step when wallet connects
    useEffect(() => {
        if (step === 1 && isWalletConnected) {
            setStep(2);
        }
    }, [step, isWalletConnected]);

    useEffect(() => {
        const referrerWallet = searchParams.get("ref");
        if (!referrerWallet) return;
        const normalizedReferrer = referrerWallet.trim();
        if (!normalizedReferrer) return;
        setPendingReferrerWallet(normalizedReferrer);
    }, [searchParams, setPendingReferrerWallet]);

    // Redirect if user already has a handle
    useEffect(() => {
        if (currentUser?.handle) {
            router.push("/feed");
        }
    }, [currentUser, router]);

    // Wait for chain preference to load to prevent UI flash
    if (!isChainLoaded) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        );
    }

    const handleProfileSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            await updateProfile({ handle: username, bio });
            setStep(3);
        } catch (error) {
            console.error(error);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleComplete = () => {
        router.push("/feed");
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center p-4 relative overflow-hidden">
            {/* Background Elements */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden -z-10">
                <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/10 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-accent/10 rounded-full blur-3xl" />
            </div>

            <div className="w-full max-w-md">
                <div className="text-center mb-8">
                    <Logo size="xl" className="justify-center mb-4" />
                    <div className="flex items-center justify-center gap-2 mb-8">
                        <StepIndicator current={step} step={1} />
                        <div className={`h-1 w-8 rounded-full ${step > 1 ? "bg-primary" : "bg-secondary"}`} />
                        <StepIndicator current={step} step={2} />
                        <div className={`h-1 w-8 rounded-full ${step > 2 ? "bg-primary" : "bg-secondary"}`} />
                        <StepIndicator current={step} step={3} />
                    </div>
                </div>

                <div className="bg-card border border-border rounded-2xl p-6 md:p-8 shadow-xl backdrop-blur-sm">
                    {step === 1 && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
                            <div className="text-center">
                                <h2 className="text-2xl font-bold mb-2">Connect Wallet</h2>
                                <p className="text-muted-foreground">Link your wallet to start making onchain calls.</p>
                            </div>

                            {/* Chain Selector */}
                            <div className="flex justify-center gap-3">
                                <button
                                    onClick={() => setSelectedChain('base')}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-3 rounded-xl border transition-all",
                                        selectedChain === 'base'
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border hover:border-primary/50"
                                    )}
                                >
                                    <span>🔵</span>
                                    <span className="font-medium">Base</span>
                                </button>
                                <button
                                    onClick={() => setSelectedChain('stellar')}
                                    className={cn(
                                        "flex items-center gap-2 px-4 py-3 rounded-xl border transition-all",
                                        selectedChain === 'stellar'
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border hover:border-primary/50"
                                    )}
                                >
                                    <span>⭐</span>
                                    <span className="font-medium">Stellar</span>
                                </button>
                            </div>

                            {/* Wallet Connect - Chain specific */}
                            <div className="flex flex-col items-center gap-3">
                                {selectedChain === 'base' ? (
                                    <OnchainKitWallet>
                                        <ConnectWallet className="w-full">
                                            <Avatar className="h-6 w-6" />
                                            <Name />
                                        </ConnectWallet>
                                    </OnchainKitWallet>
                                ) : (
                                    <>
                                        {isStellarConnected ? (
                                            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-secondary border border-border">
                                                <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                                                <span className="font-mono text-sm">
                                                    {stellarAddress?.slice(0, 6)}...{stellarAddress?.slice(-4)}
                                                </span>
                                            </div>
                                        ) : (
                                            <button
                                                onClick={async () => {
                                                    try {
                                                        await connectStellar();
                                                    } catch (error) {
                                                        console.error("Failed to connect Stellar:", error);
                                                        if (!isFreighterInstalled) {
                                                            alert("Freighter wallet not installed.\n\nInstall from: https://www.freighter.app/");
                                                        }
                                                    }
                                                }}
                                                disabled={isStellarConnecting}
                                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                                            >
                                                {isStellarConnecting ? (
                                                    <Loader2 className="h-5 w-5 animate-spin" />
                                                ) : (
                                                    <>
                                                        <span>⭐</span>
                                                        Connect Freighter
                                                    </>
                                                )}
                                            </button>
                                        )}
                                        {isFreighterCheckComplete && !isFreighterInstalled && !isStellarConnected && (
                                            <p className="text-xs text-yellow-500">
                                                Freighter not detected.{" "}
                                                <a
                                                    href="https://www.freighter.app/"
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="underline hover:no-underline"
                                                >
                                                    Install it here
                                                </a>
                                            </p>
                                        )}
                                    </>
                                )}
                            </div>

                            <p className="text-xs text-center text-muted-foreground">
                                By connecting, you agree to our Terms of Service and Privacy Policy.
                            </p>
                        </div>
                    )}

                    {step === 2 && (
                        isLoading ? (
                            <div className="flex flex-col items-center justify-center py-12 animate-in fade-in">
                                <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
                                <p className="text-muted-foreground">Verifying wallet...</p>
                            </div>
                        ) : (
                            <form onSubmit={handleProfileSubmit} className="space-y-6 animate-in fade-in slide-in-from-right-4">
                                <div className="text-center">
                                    <h2 className="text-2xl font-bold mb-2">Create Profile</h2>
                                    <p className="text-muted-foreground">Set up your identity on BackIT.</p>
                                </div>

                                <div className="flex justify-center mb-6">
                                    <div className="h-24 w-24 rounded-full bg-secondary border-2 border-dashed border-muted-foreground/50 flex items-center justify-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-all">
                                        <User className="h-8 w-8 text-muted-foreground" />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <div>
                                        <label className="text-sm font-medium mb-1.5 block">Username</label>
                                        <input
                                            type="text"
                                            placeholder="@username"
                                            value={username}
                                            onChange={(e) => setUsername(e.target.value)}
                                            className="w-full bg-secondary/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50"
                                            required
                                        />
                                    </div>
                                    <div>
                                        <label className="text-sm font-medium mb-1.5 block">Bio (Optional)</label>
                                        <textarea
                                            placeholder="What's your trading thesis?"
                                            value={bio}
                                            onChange={(e) => setBio(e.target.value)}
                                            className="w-full bg-secondary/50 border border-border rounded-lg px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[80px] resize-none"
                                        />
                                    </div>
                                </div>

                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 rounded-xl transition-colors disabled:opacity-50"
                                >
                                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : "Continue"}
                                </button>
                            </form>
                        )
                    )}

                    {step === 3 && (
                        <div className="text-center space-y-6 animate-in fade-in slide-in-from-right-4">
                            <div className="h-20 w-20 bg-green-500/20 text-green-500 rounded-full flex items-center justify-center mx-auto mb-4">
                                <CheckCircle2 className="h-10 w-10" />
                            </div>

                            <div>
                                <h2 className="text-2xl font-bold mb-2">You&apos;re All Set!</h2>
                                <p className="text-muted-foreground">Your wallet is connected and profile is ready. Start exploring calls or make your first prediction.</p>
                            </div>

                            <button
                                onClick={handleComplete}
                                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-medium py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
                            >
                                Enter BackIT
                                <ArrowRight className="h-5 w-5" />
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

function StepIndicator({ current, step }: { current: number; step: number }) {
    const isActive = current >= step;
    const isCurrent = current === step;

    return (
        <div
            className={cn(
                "h-8 w-8 rounded-full flex items-center justify-center text-sm font-bold transition-all",
                isActive
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground",
                isCurrent ? "ring-4 ring-primary/20" : ""
            )}
        >
            {step}
        </div>
    );
}
