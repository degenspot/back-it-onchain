export interface KeyRotationProposal {
  currentKey: string;
  newKey: string;
  proposedAt: number;
  activationTimelockSeconds: number;
}

export function proposeKeyRotation(currentKey: string, newKey: string, timelockSeconds: number = 86400): KeyRotationProposal {
  return {
    currentKey,
    newKey,
    proposedAt: Date.now(),
    activationTimelockSeconds: timelockSeconds,
  };
}

export function isKeyRotationReady(proposal: KeyRotationProposal): boolean {
  const elapsed = (Date.now() - proposal.proposedAt) / 1000;
  return elapsed >= proposal.activationTimelockSeconds;
}
