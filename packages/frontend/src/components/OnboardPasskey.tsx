"use client";

import { useState } from "react";
import { KeyRound, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface OnboardPasskeyProps {
  onComplete: (walletAddress: string) => void;
}

export function OnboardPasskey({ onComplete }: OnboardPasskeyProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [created, setCreated] = useState(false);

  const handleCreatePasskey = async () => {
    setIsCreating(true);
    try {
      // Simulate passkey creation + embedded wallet generation
      await new Promise(resolve => setTimeout(resolve, 1500));
      const mockAddress = "0x" + Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      setCreated(true);
      setTimeout(() => onComplete(mockAddress), 500);
    } catch (error) {
      console.error("Failed to create passkey:", error);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-2">Create Passkey</h2>
        <p className="text-muted-foreground">
          Set up a passkey for secure, passwordless authentication.
        </p>
      </div>

      <div className="flex justify-center">
        <div className={`h-24 w-24 rounded-full flex items-center justify-center transition-all ${
            created
              ? "bg-green-500/20 text-green-500"
              : "bg-secondary border-2 border-dashed border-muted-foreground/50"
          }`}>
          {created ? (
            <CheckCircle2 className="h-10 w-10" />
          ) : (
            <KeyRound className="h-10 w-10 text-muted-foreground" />
          )}
        </div>
      </div>

      <div className="bg-secondary/50 rounded-lg p-4 border border-border space-y-2">
        <p className="text-sm font-medium">What is a passkey?</p>
        <ul className="text-xs text-muted-foreground space-y-1">
          <li>• Passwordless sign-in using biometrics or PIN</li>
          <li>• Secured by your device&apos;s hardware</li>
          <li>• No seed phrase to remember</li>
        </ul>
      </div>

      <Button
        onClick={handleCreatePasskey}
        disabled={isCreating || created}
        className="w-full"
      >
        {isCreating ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Creating Passkey...
          </>
        ) : created ? (
          "Passkey Created"
        ) : (
          "Create Passkey"
        )}
      </Button>
    </div>
  );
}