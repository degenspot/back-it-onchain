"use client";

import { useState, useEffect } from "react";
import { Eye, EyeOff, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface FlaggedCall {
  id: string;
  title: string;
  creator: string;
  reason: string;
  reportedAt: string;
  status: "pending" | "hidden" | "resolved";
}

export function FlaggedTable() {
  const [calls, setCalls] = useState<FlaggedCall[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    // Mock data for now - will hit /admin/flagged endpoint
    setTimeout(() => {
      setCalls([
        { id: "1", title: "BTC will hit $100k", creator: "0x1234...5678", reason: "Misleading title", reportedAt: "2025-01-15", status: "pending" },
        { id: "2", title: "ETH price prediction", creator: "0x9abc...def0", reason: "Spam content", reportedAt: "2025-01-14", status: "pending" },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);
  
  const handleHide = (id: string) => {
    setCalls(prev => prev.map(c => c.id === id ? { ...c, status: "hidden" } : c));
  };
  
  const handleUnhide = (id: string) => {
    setCalls(prev => prev.map(c => c.id === id ? { ...c, status: "pending" } : c));
  };
  
  const handleResolve = (id: string) => {
    setCalls(prev => prev.map(c => c.id === id ? { ...c, status: "resolved" } : c));
  };
  
  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading flagged calls...</div>;
  }
  
  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-card">
      <div className="grid grid-cols-[1fr_150px_120px_120px] gap-3 px-4 py-3 text-xs uppercase tracking-wide text-muted-foreground border-b border-border bg-secondary/20">
        <span>Call</span>
        <span>Reported</span>
        <span>Status</span>
        <span>Actions</span>
      </div>
      
      {calls.length === 0 ? (
        <div className="p-10 text-center text-muted-foreground">No flagged calls.</div>
      ) : (
        calls.map(call => (
          <div key={call.id} className="grid grid-cols-[1fr_150px_120px_120px] gap-3 px-4 py-3 border-b border-border/60 text-sm items-center">
            <div>
              <p className="font-medium">{call.title}</p>
              <p className="text-xs text-muted-foreground">{call.reason}</p>
            </div>
            <span className="text-xs text-muted-foreground">{call.reportedAt}</span>
            <Badge tone={call.status === "resolved" ? "green" : call.status === "hidden" ? "red" : "yellow"}>
              {call.status}
            </Badge>
            <div className="flex gap-2">
              {call.status === "hidden" ? (
                <Button variant="ghost" size="sm" onClick={() => handleUnhide(call.id)}>
                  <Eye className="h-4 w-4" />
                </Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => handleHide(call.id)}>
                  <EyeOff className="h-4 w-4" />
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => handleResolve(call.id)}>
                <CheckCircle2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
