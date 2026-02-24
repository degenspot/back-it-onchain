"use client";

import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock3, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import type { Hash } from "viem";

type TxToastVariant = "submitted" | "confirmed" | "failed";

interface TxToastOptions {
  title: string;
  description: string;
  hash?: Hash;
  chainId?: number;
}

const TX_TOAST_DURATION_MS = 12_000;

const getExplorerTxUrl = (hash: Hash, chainId?: number): string | undefined => {
  if (!chainId) return undefined;

  const explorerByChainId: Record<number, string> = {
    8453: "https://basescan.org/tx/",
    84532: "https://sepolia.basescan.org/tx/",
  };

  const baseUrl = explorerByChainId[chainId];
  return baseUrl ? `${baseUrl}${hash}` : undefined;
};

const TxToastCard = ({
  variant,
  title,
  description,
  explorerUrl,
}: {
  variant: TxToastVariant;
  title: string;
  description: string;
  explorerUrl?: string;
}) => {
  const iconByVariant = {
    submitted: <Clock3 className="h-5 w-5 text-amber-500" />,
    confirmed: <CheckCircle2 className="h-5 w-5 text-emerald-500" />,
    failed: <AlertCircle className="h-5 w-5 text-red-500" />,
  };

  return (
    <div className="w-[340px] rounded-lg border border-zinc-700 bg-zinc-900 p-3 text-white shadow-xl">
      <div className="flex items-start gap-2">
        {iconByVariant[variant]}
        <div className="flex-1">
          <p className="text-sm font-semibold">{title}</p>
          <p className="mt-1 text-xs text-zinc-300">{description}</p>
          {explorerUrl ? (
            <Link
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-sky-300 hover:text-sky-200"
            >
              View on explorer
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
};

const showTxToast = (variant: TxToastVariant, options: TxToastOptions) => {
  const explorerUrl = options.hash
    ? getExplorerTxUrl(options.hash, options.chainId)
    : undefined;

  toast.custom(
    () => (
      <TxToastCard
        variant={variant}
        title={options.title}
        description={options.description}
        explorerUrl={explorerUrl}
      />
    ),
    {
      duration: TX_TOAST_DURATION_MS,
    },
  );
};

export const showTxSubmittedToast = (options: TxToastOptions) => {
  showTxToast("submitted", options);
};

export const showTxConfirmedToast = (options: TxToastOptions) => {
  showTxToast("confirmed", options);
};

export const showTxFailedToast = (options: TxToastOptions) => {
  showTxToast("failed", options);
};
