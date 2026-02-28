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

export default function CreatePage() {
    const { createCall, isLoading } = useGlobalState();
    const router = useRouter();

    // Dynamic validation for Target Price based on asset (token)
    const getTargetPriceSchema = (asset: string) => {
        if (asset.toUpperCase() === "ETH") {
            return z.string().refine(val => {
                const num = parseFloat(val.replace(/[^0-9.]/g, ""));
                return num >= 100 && num <= 100000;
            }, {
                message: "Target price for ETH must be between $100 and $100,000"
            });
        }
        return z.string().refine(val => {
            const num = parseFloat(val.replace(/[^0-9.]/g, ""));
            return num > 0;
        }, {
            message: "Target price must be a positive number"
        });
    };

    const CreateCallSchema = z.object({
        title: z.string().min(5, "Title is required and must be at least 5 characters"),
        thesis: z.string().optional(),
        asset: z.string().min(2, "Asset is required"),
        target: z.string(),
        deadline: z.string().refine(val => {
            const date = new Date(val);
            return date > new Date();
        }, {
            message: "End date must be in the future"
        }),
        stake: z.string().refine(val => {
            const num = parseFloat(val);
            return num > 0;
        }, {
            message: "Stake amount must be positive"
        })
    });

    const {
        register,
        handleSubmit,
        formState: { errors },
        watch,
        setError,
        clearErrors
    } = useForm({
        resolver: zodResolver(CreateCallSchema),
        mode: "onChange"
    });

    const asset = watch("asset");
    const target = watch("target");

    React.useEffect(() => {
        if (asset && target) {
            const schema = getTargetPriceSchema(asset);
            const result = schema.safeParse(target);
            if (!result.success) {
                setError("target", { type: "manual", message: result.error.issues[0].message });
            } else {
                clearErrors("target");
            }
        }
    }, [asset, target, setError, clearErrors]);

    const onSubmit = async (data: any) => {
        await createCall(data);
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
                        <label className="text-sm font-medium flex items-center gap-2">
                            <Type className="h-4 w-4 text-primary" />
                            Prediction Title
                        </label>
                        <input
                            type="text"
                            placeholder="e.g., ETH will flip BTC by 2025"
                            className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                            {...register("title")}
                        />
                        {errors.title && <p className="text-red-500 text-xs mt-1">{errors.title.message}</p>}
                    </div>

                    {/* Thesis */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium">Thesis (Optional)</label>
                        <textarea
                            placeholder="Why do you think this will happen?"
                            className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 min-h-[100px] resize-none transition-all"
                            {...register("thesis")}
                        />
                        {errors.thesis && <p className="text-red-500 text-xs mt-1">{errors.thesis.message}</p>}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Asset */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-primary" />
                                Asset
                            </label>
                            <input
                                type="text"
                                placeholder="e.g., ETH"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("asset")}
                            />
                            {errors.asset && <p className="text-red-500 text-xs mt-1">{errors.asset.message}</p>}
                        </div>

                        {/* Target Price */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <Target className="h-4 w-4 text-primary" />
                                Target Price / Condition
                            </label>
                            <input
                                type="text"
                                placeholder="e.g., $5,000"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("target")}
                            />
                            {errors.target && <p className="text-red-500 text-xs mt-1">{errors.target.message}</p>}
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Deadline */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <Calendar className="h-4 w-4 text-primary" />
                                Deadline
                            </label>
                            <input
                                type="date"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("deadline")}
                            />
                            {errors.deadline && <p className="text-red-500 text-xs mt-1">{errors.deadline.message}</p>}
                        </div>

                        {/* Stake Amount */}
                        <div className="space-y-2">
                            <label className="text-sm font-medium flex items-center gap-2">
                                <DollarSign className="h-4 w-4 text-primary" />
                                Your Stake (USDC)
                            </label>
                            <input
                                type="number"
                                placeholder="100"
                                className="w-full bg-secondary/50 border border-border rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-primary/50 transition-all"
                                {...register("stake")}
                            />
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
// ...existing code...
