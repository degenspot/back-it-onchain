"use client";

import { useState, useRef, useEffect } from "react";
import { Search, X, Filter, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { useSearch, type SearchType, type SearchChain, type SearchSort } from "@/hooks/useSearch";

export function SearchBar() {
  const router = useRouter();
  const { query, setQuery, filters, setFilters, results, isLoading } = useSearch();
  const [showFilters, setShowFilters] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsFocused(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return text;
    const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return text.replace(regex, '<mark class="bg-primary/30 text-foreground rounded px-0.5">$1</mark>');
  };

  const handleSelect = (result: { id: string; type: string }) => {
    setIsFocused(false);
    if (result.type === "call") {
      router.push(`/calls/${result.id}`);
    } else {
      router.push(`/profile/${result.id}`);
    }
  };

  const handleSearchPage = () => {
    router.push(`/search?q=${encodeURIComponent(query)}&type=${filters.type}&chain=${filters.chain}`);
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xl" data-testid="search-bar">
      <div className={cn(
        "flex items-center gap-2 px-4 py-2.5 rounded-xl border transition-all",
        isFocused ? "border-primary bg-secondary/50 shadow-lg" : "border-border bg-secondary/20"
      )}>
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <input
          ref={inputRef}
          type="text"
          placeholder="Search calls, users..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setIsFocused(true)}
          className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          data-testid="search-input"
        />
        {query && (
          <button onClick={() => setQuery("")} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={cn("p-1 rounded", showFilters ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground")}
        >
          <Filter className="h-4 w-4" />
        </button>
      </div>

      {showFilters && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl p-3 shadow-lg z-50 space-y-3">
          <div>
            <p className="text-xs text-muted-foreground mb-2">Type</p>
            <div className="flex gap-2">
              {(["calls", "users"] as SearchType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilters(prev => ({ ...prev, type }))}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
                    filters.type === type ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Chain</p>
            <div className="flex gap-2">
              {(["all", "base", "stellar"] as SearchChain[]).map((chain) => (
                <button
                  key={chain}
                  onClick={() => setFilters(prev => ({ ...prev, chain }))}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors",
                    filters.chain === chain ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {chain}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2">Sort</p>
            <div className="flex gap-2">
              {(["relevance", "recent", "popular"] as SearchSort[]).map((sort) => (
                <button
                  key={sort}
                  onClick={() => setFilters(prev => ({ ...prev, sort }))}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors",
                    filters.sort === sort ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {sort}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {isFocused && query.trim() && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center p-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Searching...
            </div>
          ) : results.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">No results found.</div>
          ) : (
            <>
              {results.slice(0, 8).map((result) => (
                <button
                  key={result.id}
                  onClick={() => handleSelect(result)}
                  className="w-full text-left px-4 py-3 hover:bg-secondary/50 transition-colors border-b border-border/50 last:border-0"
                  data-testid={`search-result-${result.id}`}
                >
                  <p
                    className="text-sm font-medium"
                    dangerouslySetInnerHTML={{ __html: highlightMatch(result.title, query) }}
                  />
                  <p className="text-xs text-muted-foreground capitalize">{result.type}{result.chain ? ` · ${result.chain}` : ""}</p>
                </button>
              ))}
              <button
                onClick={handleSearchPage}
                className="w-full px-4 py-3 text-sm text-primary text-center hover:bg-secondary/50"
              >
                View all results
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
