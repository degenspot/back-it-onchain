"use client";

import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

const WS_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001";

export interface SocketCallEvent {
  callOnchainId?: string;
  id?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

interface UseSocketOptions {
  onCallCreated?: (data: SocketCallEvent) => void;
  onStakeAdded?: (data: SocketCallEvent) => void;
  onOutcomeResolved?: (data: SocketCallEvent) => void;
  token?: string;
}

export function useSocket({
  onCallCreated,
  onStakeAdded,
  onOutcomeResolved,
  token,
}: UseSocketOptions) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(`${WS_URL}/events`, {
      transports: ["websocket"],
      ...(token ? { extraHeaders: { Authorization: `Bearer ${token}` } } : {}),
    });

    socketRef.current = socket;

    if (onCallCreated) socket.on("call_created", onCallCreated);
    if (onStakeAdded) socket.on("stake_added", onStakeAdded);
    if (onOutcomeResolved) socket.on("outcome_resolved", onOutcomeResolved);

    return () => {
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return socketRef;
}
