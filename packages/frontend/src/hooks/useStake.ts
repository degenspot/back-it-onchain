import { useState, useCallback } from "react";

export type StakePosition = "YES" | "NO";
export type StakeStep = "idle" | "approving" | "staking" | "success" | "error";

interface StakeState {
  step: StakeStep;
  error: string | null;
  txHash: string | null;
}

export function useStake(callId: string) {
  const [position, setPosition] = useState<StakePosition>("YES");
  const [amount, setAmount] = useState("");
  const [state, setState] = useState<StakeState>({
    step: "idle",
    error: null,
    txHash: null,
  });

  const maxAmount = 10000; // Mock max balance

  const approve = useCallback(async () => {
    setState({ step: "approving", error: null, txHash: null });
    try {
      // Simulate ERC-20 approve
      await new Promise(resolve => setTimeout(resolve, 1000));
      return true;
    } catch (err) {
      setState({ step: "error", error: "Approval failed", txHash: null });
      return false;
    }
  }, []);

  const stake = useCallback(async () => {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) {
      setState({ step: "error", error: "Invalid amount", txHash: null });
      return;
    }
    
    setState({ step: "staking", error: null, txHash: null });
    try {
      // Simulate staking transaction
      await new Promise(resolve => setTimeout(resolve, 1500));
      const mockHash = "0x" + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      setState({ step: "success", error: null, txHash: mockHash });
    } catch (err) {
      setState({ step: "error", error: "Staking failed", txHash: null });
    }
  }, [amount]);

  const executeStake = useCallback(async () => {
    const approved = await approve();
    if (approved) {
      await stake();
    }
  }, [approve, stake]);

  const reset = useCallback(() => {
    setState({ step: "idle", error: null, txHash: null });
    setAmount("");
  }, []);

  const estimatedPayout = parseFloat(amount) || 0;

  return {
    position,
    setPosition,
    amount,
    setAmount,
    state,
    maxAmount,
    executeStake,
    reset,
    estimatedPayout,
  };
}
