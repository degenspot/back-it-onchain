import { useState, useCallback, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

export type SearchType = "calls" | "users";
export type SearchChain = "all" | "base" | "stellar";
export type SearchSort = "relevance" | "recent" | "popular";

interface SearchFilters {
  type: SearchType;
  chain: SearchChain;
  sort: SearchSort;
}

interface SearchResult {
  id: string;
  title: string;
  type: "call" | "user";
  chain?: "base" | "stellar";
  score?: number;
}

const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3001"
).replace(/\/+$/, "");

async function fetchSearch(
  query: string,
  filters: SearchFilters
): Promise<SearchResult[]> {
  if (!query.trim()) return [];
  const params = new URLSearchParams({
    q: query,
    type: filters.type,
    chain: filters.chain,
    sort: filters.sort,
  });
  const response = await fetch(`${API_BASE_URL}/search?${params}`);
  if (!response.ok) throw new Error("Search failed");
  return response.json();
}

export function useSearch() {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<SearchFilters>({
    type: "calls",
    chain: "all",
    sort: "relevance",
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [debouncedQuery, setDebouncedQuery] = useState("");

  const updateQuery = useCallback((newQuery: string) => {
    setQuery(newQuery);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedQuery(newQuery);
    }, 300);
  }, []);

  const { data: results = [], isLoading, error } = useQuery({
    queryKey: ["search", debouncedQuery, filters],
    queryFn: () => fetchSearch(debouncedQuery, filters),
    enabled: debouncedQuery.trim().length > 0,
    staleTime: 30_000,
  });

  return {
    query,
    setQuery: updateQuery,
    filters,
    setFilters,
    results,
    isLoading,
    error,
  };
}
