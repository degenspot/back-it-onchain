/**
 * Crash reporting plumbing for widget-level error boundaries (FE-041).
 *
 * Errors thrown inside a widget frequently carry user-identifying material in
 * their message: a wallet address interpolated into an RPC failure, a signed
 * payload echoed back by a provider. Anything captured here is sanitised before
 * it leaves the process.
 */

export interface WidgetErrorReport {
  /** Which widget boundary caught the error, e.g. "Feed". */
  widget: string;
  /** Sanitised error message. Never the raw one. */
  message: string;
  /** Sanitised React component stack, when React supplied one. */
  componentStack?: string;
  /** Sanitised breadcrumbs describing what preceded the crash. */
  breadcrumbs: string[];
  timestamp: string;
}

/** A sink that receives sanitised reports. */
export type WidgetErrorSink = (report: WidgetErrorReport) => void;

const REDACTED = "[redacted]";

/**
 * Patterns for material that must never reach a reporting backend.
 *
 * Ordered most specific first: a Stellar secret seed also matches the generic
 * Stellar address shape, so it has to be redacted before the looser rule runs.
 */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // Stellar secret seed (S...) — strictly before the public-key rule.
  { pattern: /\bS[A-Z2-7]{55}\b/g, label: "stellar-secret" },
  // Stellar public key (G...).
  { pattern: /\bG[A-Z2-7]{55}\b/g, label: "stellar-address" },
  // Hex private key, with or without 0x, 64 hex chars.
  { pattern: /\b(?:0x)?[a-fA-F0-9]{64}\b/g, label: "hex-key" },
  // EVM address.
  { pattern: /\b0x[a-fA-F0-9]{40}\b/g, label: "evm-address" },
  // Anything that looks like a mnemonic: 12 or 24 lowercase words.
  {
    pattern: /\b(?:[a-z]{3,8}\s+){11}[a-z]{3,8}(?:(?:\s+[a-z]{3,8}){12})?\b/g,
    label: "mnemonic",
  },
];

/**
 * Strips wallet addresses, keys and seed phrases from an arbitrary string.
 *
 * Fails closed: if anything goes wrong while sanitising we return a fixed
 * placeholder rather than risk emitting the original text.
 */
export function sanitizeErrorText(input: string | undefined | null): string {
  if (!input) return "";
  try {
    let output = String(input);
    for (const { pattern, label } of SENSITIVE_PATTERNS) {
      output = output.replace(pattern, `${REDACTED}:${label}`);
    }
    return output;
  } catch {
    return REDACTED;
  }
}

/**
 * The active sink. Defaults to the console so crashes stay visible in
 * development and in any environment without a reporting backend configured.
 */
let sink: WidgetErrorSink = (report) => {
  console.error(
    `[widget-error] ${report.widget}: ${report.message}`,
    report.componentStack ?? "",
  );
};

/**
 * Registers the reporting backend.
 *
 * Sentry is wired here rather than inline so the boundary has no direct
 * dependency on a vendor SDK. Once a DSN is provisioned, initialise the SDK in
 * `instrumentation-client.ts` and register it:
 *
 *   setWidgetErrorSink((report) =>
 *     Sentry.captureMessage(report.message, {
 *       level: "error",
 *       tags: { widget: report.widget },
 *       extra: {
 *         componentStack: report.componentStack,
 *         breadcrumbs: report.breadcrumbs,
 *       },
 *     }),
 *   );
 *
 * Everything reaching the sink is already sanitised.
 */
export function setWidgetErrorSink(next: WidgetErrorSink): void {
  sink = next;
}

/** Restores the default console sink. Used by tests. */
export function resetWidgetErrorSink(): void {
  sink = (report) => {
    console.error(
      `[widget-error] ${report.widget}: ${report.message}`,
      report.componentStack ?? "",
    );
  };
}

/** Sanitises and forwards a widget crash to the active sink. */
export function reportWidgetError(input: {
  widget: string;
  error: Error;
  componentStack?: string;
  breadcrumbs?: string[];
}): WidgetErrorReport {
  const report: WidgetErrorReport = {
    widget: input.widget,
    message: sanitizeErrorText(input.error?.message) || "Unknown error",
    componentStack: input.componentStack
      ? sanitizeErrorText(input.componentStack)
      : undefined,
    breadcrumbs: (input.breadcrumbs ?? []).map((b) => sanitizeErrorText(b)),
    timestamp: new Date().toISOString(),
  };

  try {
    sink(report);
  } catch {
    // A failing reporter must never escalate into a second crash.
  }

  return report;
}
