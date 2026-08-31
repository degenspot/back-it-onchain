"use client";

import { useState } from "react";
import { Shield, Loader2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface SmartAccountPreviewProps {
  walletAddress: string | null;
  onComplete: () => void;
}

export function SmartAccountPreview({ walletAddress, onComplete }: SmartAccountPreviewProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const handleCreateSmartAccount = async () => {
    setIsCreating(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 2000));
      setCreated(true);
    } catch (error) {
      console.error("Failed to create smart account:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-right-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Smart Account</h2>
        <p className="text-muted-foreground">
          An account abstraction (AA) account for gasless transactions.
        </p>
      </div>

      <div className="bg-secondary/50 rounded-lg p-4 border border-border space-y-3">
        <div className="flex items-center gap-3">
          <Shield className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium">ERC-4337 Smart Account</p>
            <p className="text-xs text-muted-foreground">Sponsored gas via paymaster</p>
          </div>
        </div>
        {walletAddress && (
          <div className="pt-2 border-t border-border">
            <p className="text-xs text-muted-foreground mb-1">Linked to</p>
            <p className="font-mono text-xs break-all">{walletAddress}</p>
          </div>
        )}
      </div>

      <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
        <p className="text-sm text-primary">
          Paymaster sponsorship: First 10 transactions are gas-free.
        </p>
      </div>

      {!created ? (
        <Button
          onClick={handleCreateSmartAccount}
          disabled={isCreating}
          className="w-full"
        >
          {isCreating ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin mr-2" />
              Creating Smart Account...
            </>
          ) : (
            "Create Smart Account"
          )}
        </Button>
      ) : (
        <Button onClick={onComplete} className="w-full">
          Continue
          <ArrowRight className="h-4 w-4 ml-2" />
        </Button>
      )}
    </div>
  );
}