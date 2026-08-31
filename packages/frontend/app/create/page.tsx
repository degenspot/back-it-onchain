"use client";

import { AppLayout } from "@/components/AppLayout";
import { ArrowRight, Calendar, DollarSign, Target, Type } from 'lucide-react';
import * as React from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useGlobalState } from "@/components/GlobalState";
import { useRouter } from "next/navigation";
import { Loader } from "@/components/ui/Loader";
import { ERC20ABI } from "@/lib/abis";
import { formatUnits, parseUnits } from "viem";
import { useAccount, usePublicClient } from "wagmi";

const CONDITION_TYPES = ["above", "below"] as const;

const TARGET_PRICE_RULES: Record<string, { min: number; max: number; decimals: number }> = {
    ETH: { min: 100, max: 100000, decimals: 2 },
    BTC: { min: 1000, max: 250000, decimals: 2 },
    SOL: { min: 1, max: 5000, decimals: 3 },
    XLM: { min: 0.01, max: 50, decimals: 4 },
    USDC: { min: 0.95, max: 1.05, decimals: 4 },
};

const DEFAULT_TARGET_RULE = { min: 0.000001, max: 1000000000, decimals: 8 };
const STAKE_DECIMALS = 18;

const parsePrice = (value: string): number =>
    Number.parseFloat(value.replace(/[$,\s]/g, ""));

const getTargetRule = (asset: string) =>
    TARGET_PRICE_RULES[asset.trim().toUpperCase()] ?? DEFAULT_TARGET_RULE;

const toEndOfDay = (dateInput: string): Date =>
    new Date(`${dateInput}T23:59:59`);

export default function CreatePage() {
    const { createCall, isLoading } = useGlobalState();
    const router = useRouter();
    const publicClient = usePublicClient();
    const { address } = useAccount();

    const [walletStakeBalance, setWalletStakeBalance] = React.useState<bigint | null>(null);
    const stakeTokenAddress = process.env.NEXT_PUBLIC_MOCK_TOKEN_ADDRESS as `0x${string}` | undefined;

    React.useEffect(() => {
        let cancelled = false;

        const fetchStakeBalance = async () => {
            if (!publicClient || !address || !stakeTokenAddress) {
                setWalletStakeBalance(null);
                return;
            }

            try {
                const balance = await publicClient.readContract({
                    address: stakeTokenAddress,
                    abi: ERC20ABI,
                    functionName: "balanceOf",
                    args: [address],
                });

                if (!cancelled) {
                    setWalletStakeBalance(balance as bigint);
                }
            } catch {
                if (!cancelled) {
                    setWalletStakeBalance(null);
                }
            }
        };

        void fetchStakeBalance();

        return () => {
            cancelled = true;
        };
    }, [address, publicClient, stakeTokenAddress]);

    const createCallSchema = React.useMemo(
        () =>
            z
                .object({
                    title: z
                        .string()
                        .trim()
                        .min(5, "Title is required and must be at least 5 characters"),
                    thesis: z.string().trim().optional(),
                    asset: z.string().trim().min(2, "Asset is required"),
                    conditionType: z.enum(CONDITION_TYPES),
                    target: z.string().trim().min(1, "Target price is required"),
                    deadline: z
                        .string()
                        .min(1, "End date is required")
                        .refine((value) => toEndOfDay(value) > new Date(), {
                            message: "End date must be in the future",
                        }),
                    stake: z
                        .string()
                        .trim()
                        .refine((value) => Number.parseFloat(value) > 0, {
                            message: "Stake amount must be positive",
                        }),
                })
                .strict()
                .superRefine((data, ctx) => {
                    const rule = getTargetRule(data.asset);
                    const targetNumber = parsePrice(data.target);

                    if (!Number.isFinite(targetNumber)) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: ["target"],
                            message: "Target price must be a valid number",
                        });
                        return;
                    }

                    if (targetNumber < rule.min || targetNumber > rule.max) {
                        ctx.addIssue({
                            code: z.ZodIssueCode.custom,
                            path: ["target"],
                            message: `Target price for ${data.asset.toUpperCase()} must be between $${rule.min.toLocaleString(undefined, {
                                maximumFractionDigits: rule.decimals,
                            })} and $${rule.max.toLocaleString(undefined, {
                                maximumFractionDigits: rule.decimals,
                            })}`,
                        });
                    }

                    const stakeNumber = Number.parseFloat(data.stake);
                    if (!Number.isFinite(stakeNumber) || stakeNumber <= 0) {
                        return;
                    }

                    if (walletStakeBalance !== null) {
                        try {
                            const normalizedStake = parseUnits(data.stake, STAKE_DECIMALS);
                            if (normalizedStake > walletStakeBalance) {
                                ctx.addIssue({
                                    code: z.ZodIssueCode.custom,
                                    path: ["stake"],
                                    message: "Stake amount exceeds balance",
                                });
                            }
                        } catch {
                            ctx.addIssue({
                                code: z.ZodIssueCode.custom,
                                path: ["stake"],
                                message: "Stake amount has too many decimal places",
                            });
                        }
                    }
                }),
        [walletStakeBalance]
    );

    type CreateCallFormData = z.infer<typeof createCallSchema>;

    const {
        register,
        handleSubmit,
        formState: { errors },
        trigger,
    } = useForm<CreateCallFormData>({
        resolver: zodResolver(createCallSchema),
        mode: "onChange",
        defaultValues: {
            conditionType: "above",
        },
    });

    React.useEffect(() => {
        void trigger("stake");
    }, [walletStakeBalance, trigger]);

    const onSubmit = async (data: CreateCallFormData) => {
        await createCall({
            title: data.title,
            thesis: data.thesis?.trim() ?? "",
            asset: data.asset,
            target: `${data.conditionType.toUpperCase()} ${data.target}`,
            deadline: data.deadline,
            stake: data.stake,
        });
        router.push('/feed');
    };

    const RightSidebar = (
        <div className="bg-secondary/20 rounded-xl p-6 border border-border">
            <h3 className="font-bold text-lg mb-2">How it works</h3>
            <ul className="space-y-3 text-sm text-muted-foreground list-disc pl-4">
                <li>Create a prediction with a clear condition and deadline.</li>
                <li>Stake tokens to back your claim.</li>
                <li>Others can challenge your prediction by staking against it.</li>
                <li>The outcome is verified by our oracle network.</li>
                <li>Winners take the pool (minus fees).</li>
            </ul>
        </div>
    );

    return (
        <AppLayout rightSidebar={RightSidebar}>
            {isLoading && <Loader text="Creating Prediction Market..." />}
            <div className="p-6">
                <div className="mb-8">
                    <h1 className="text-2xl font-bold mb-2">Create a Prediction</h1>
                    <p className="text-muted-foreground">Put your reputation onchain. Make a call.</p>
                </div>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                    {/* Title */}
                    <div className="space-y-2">
                        <label htmlFor="create-title" className="text-sm font-medium flex items-center gap-2">
                            <Type className="h-4 w-4 text-primary" />
                            Prediction Title
                        </label>
                        <input
                            id="create-title"
                            type="text"
                            placeholder="e.g., ETH will flip BTC by 2025"
                            className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                            {...register("title")}
                        />
                        {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                    </div>

                    {/* Thesis */}
                    <div className="space-y-2">
                        <label htmlFor="create-thesis" className="text-sm font-medium">Thesis (Optional)</label>
                        <textarea
                            id="create-thesis"
                            placeholder="Why do you think this will happen?"
                            className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[100px] resize-none transition-all"
                            {...register("thesis")}
                        />
                        {errors.thesis && <p className="text-red-500 text-xs mt-1">{errors.thesis.message}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Asset */}
                        <div className="space-y-2">
                            <label htmlFor="create-asset" className="text-sm font-medium flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-primary" />
                                Asset
                            </label>
                            <input
                                id="create-asset"
                                type="text"
                                placeholder="e.g., ETH"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("asset")}
                            />
                            {errors.asset && <p className="text-red-500 text-xs mt-1">{errors.asset.message}</p>}
                        </div>

                        {/* Condition Type */}
                        <div className="space-y-2">
                            <label htmlFor="create-condition" className="text-sm font-medium flex items-center gap-2">
                                <Target className="h-4 w-4 text-primary" />
                                Condition Type
                            </label>
                            <select
                                id="create-condition"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("conditionType")}
                            >
                                <option value="above">Price goes above target</option>
                                <option value="below">Price goes below target</option>
                            </select>
                            {errors.conditionType && <p className="text-red-500 text-xs mt-1">{errors.conditionType.message}</p>}
                        </div>
                    </div>

                    {/* Target Price */}
                    <div className="space-y-2">
                        <label htmlFor="create-target" className="text-sm font-medium flex items-center gap-2">
                            <Target className="h-4 w-4 text-primary" />
                            Target Price
                        </label>
                        <input
                            id="create-target"
                            type="text"
                            placeholder="e.g., $5,000"
                            className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                            {...register("target")}
                        />
                        {errors.target && <p className="text-red-500 text-xs mt-1">{errors.target.message}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Deadline */}
                        <div className="space-y-2">
                            <label htmlFor="create-deadline" className="text-sm font-medium flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-primary" />
                                Deadline
                            </label>
                            <input
                                id="create-deadline"
                                type="date"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("deadline")}
                            />
                            {errors.deadline && <p className="text-red-500 text-xs mt-1">{errors.deadline.message}</p>}
                        </div>

                        {/* Stake Amount */}
                        <div className="space-y-2">
                            <label htmlFor="create-stake" className="text-sm font-medium flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-primary" />
                                Your Stake (USDC)
                            </label>
                            <input
                                id="create-stake"
                                type="number"
                                placeholder="100"
                                step="0.000001"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("stake")}
                            />
                            {walletStakeBalance !== null && (
                                <p className="text-xs text-muted-foreground mt-1">
                                    Available balance: {Number(formatUnits(walletStakeBalance, STAKE_DECIMALS)).toLocaleString(undefined, {
                                        maximumFractionDigits: 6,
                                    })} USDC
                                </p>
                            )}
                            {errors.stake && <p className="text-red-500 text-xs mt-1">{errors.stake.message}</p>}
                        </div>
                    </div>

                    <div className="pt-4">
                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-bold py-4 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                "Creating..."
                            ) : (
                                <>
                                    Create Prediction
                                    <ArrowRight className="h-5 w-5" />
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </AppLayout>
    );
}
