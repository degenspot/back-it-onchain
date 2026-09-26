export interface CircuitBreakerState {
  isPaused: boolean;
  gatedFunctions: Set<string>;
}

export class CircuitBreaker {
  private state: CircuitBreakerState = {
    isPaused: false,
    gatedFunctions: new Set(),
  };

  public pauseAll(): void {
    this.state.isPaused = true;
  }

  public resumeAll(): void {
    this.state.isPaused = false;
    this.state.gatedFunctions.clear();
  }

  public gateFunction(fnName: string): void {
    this.state.gatedFunctions.add(fnName);
  }

  public isAllowed(fnName: string): boolean {
    if (this.state.isPaused) return false;
    return !this.state.gatedFunctions.has(fnName);
  }
}
