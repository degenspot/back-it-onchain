'use client';

import * as React from 'react';

export interface LiveRegionProps {
  /** Text to announce. Empty renders the region but announces nothing. */
  message: string;
  /**
   * Use `assertive` for failures the user must hear immediately. Defaults to
   * polite so routine pool/stake updates never interrupt what is being read.
   */
  assertive?: boolean;
  /** Visually show the message. Off by default — this is for announcements. */
  visible?: boolean;
}

/**
 * Announces real-time socket updates to assistive technology (FE-038).
 *
 * Live pool figures and incoming stakes currently change silently: sighted
 * users see the bar move, screen reader users get nothing. This renders a
 * persistent live region so updates are announced as they arrive.
 *
 * The node is rendered even when idle — a live region injected at the same
 * moment as its text is frequently missed, because assistive technology needs
 * the region present beforehand to notice the mutation.
 */
export function LiveRegion({ message, assertive = false, visible = false }: LiveRegionProps) {
  return (
    <div
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={visible ? undefined : 'sr-only'}
      data-testid="live-region"
    >
      {message}
    </div>
  );
}

export default LiveRegion;
