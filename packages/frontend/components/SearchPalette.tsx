"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Search, User, TrendingUp, Coins, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

interface SearchResult {
  type: "user" | "call" | "token";
  id: string;
  label: string;
  sublabel?: string;
  href: string;
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const debouncedQuery = useDebounce(query, 300);

  // Cmd/Ctrl+K listener
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
      setResults([]);
    }
  }, [open]);

  // Fetch search results
  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    fetch(`${API_BASE_URL}/search?q=${encodeURIComponent(debouncedQuery)}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((data) => {
        const mapped: SearchResult[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.users ?? []).forEach((u: any) => {
          mapped.push({
            type: "user",
            id: u.wallet,
            label: u.displayName || u.handle || u.wallet,
            sublabel: u.handle ? `@${u.handle}` : undefined,
            href: `/profile?wallet=${u.wallet}`,
          });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.calls ?? []).forEach((c: any) => {
          mapped.push({
            type: "call",
            id: c.id ?? c.callOnchainId,
            label: c.conditionJson?.title || `Call #${c.callOnchainId ?? c.id}`,
            sublabel: c.conditionJson?.asset,
            href: `/calls/${c.callOnchainId ?? c.id}`,
          });
        });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data.tokens ?? []).forEach((t: any) => {
          mapped.push({
            type: "token",
            id: t.symbol,
            label: t.name || t.symbol,
            sublabel: t.symbol,
            href: `/explore?token=${t.symbol}`,
          });
        });
        setResults(mapped);
      })
      .catch(() => {/* aborted or error */})
      .finally(() => setIsLoading(false));
    return () => controller.abort();
  }, [debouncedQuery]);

  const navigate = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const iconByType = {
    user: <User className="h-4 w-4 text-sky-400" />,
    call: <TrendingUp className="h-4 w-4 text-emerald-400" />,
    token: <Coins className="h-4 w-4 text-amber-400" />,
  };

  const grouped = {
    user: results.filter((r) => r.type === "user"),
    call: results.filter((r) => r.type === "call"),
    token: results.filter((r) => r.type === "token"),
  };

  const groupLabels: Record<string, string> = {
    user: "Users",
    call: "Calls",
    token: "Tokens",
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-[20%] -translate-x-1/2 w-full max-w-lg z-50 rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl outline-none"
          aria-label="Global search"
        >
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-zinc-700">
            <Search className="h-5 w-5 text-zinc-400 shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users, calls, tokens…"
              className="flex-1 bg-transparent text-white placeholder-zinc-500 outline-none text-sm"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-zinc-500 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            )}
            <kbd className="hidden sm:inline-flex items-center gap-1 rounded border border-zinc-600 px-1.5 py-0.5 text-[10px] text-zinc-400">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-80 overflow-y-auto py-2">
            {isLoading && (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">Searching…</p>
            )}

            {!isLoading && query && results.length === 0 && (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">No results for &ldquo;{query}&rdquo;</p>
            )}

            {!isLoading && !query && (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">
                Type to search across users, calls, and tokens.
              </p>
            )}

            {(["user", "call", "token"] as const).map((type) => {
              const group = grouped[type];
              if (!group.length) return null;
              return (
                <div key={type}>
                  <p className="px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                    {groupLabels[type]}
                  </p>
                  {group.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => navigate(item.href)}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800 transition-colors text-left"
                    >
                      {iconByType[item.type]}
                      <div className="min-w-0">
                        <p className="text-sm text-white truncate">{item.label}</p>
                        {item.sublabel && (
                          <p className="text-xs text-zinc-400 truncate">{item.sublabel}</p>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
