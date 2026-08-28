"use client";

import { useState, useEffect } from "react";
import { AlertTriangle, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

interface Dispute {
  id: string;
  callTitle: string;
  disputant: string;
  reason: string;
  evidence: string;
  filedAt: string;
  status: "open" | "reviewing" | "resolved";
}

export function DisputeQueue() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  useEffect(() => {
    setTimeout(() => {
      setDisputes([
        { id: "1", callTitle: "SOL above $200", disputant: "0x1111...2222", reason: "Outcome incorrect", evidence: "Oracle data mismatch", filedAt: "2025-01-15", status: "open" },
      ]);
      setIsLoading(false);
    }, 500);
  }, []);
  
  const handleResolve = (id: string, accept: boolean) => {
    setDisputes(prev => prev.map(d => d.id === id ? { ...d, status: "resolved" } : d));
  };
  
  if (isLoading) {
    return <div className="text-center py-12 text-muted-foreground">Loading disputes...</div>;
  }
  
  return (
    <div className="space-y-4">
      {disputes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-secondary/10 p-10 text-center text-muted-foreground">
          No open disputes.
        </div>
      ) : (
        disputes.map(dispute => (
          <div key={dispute.id} className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold">{dispute.callTitle}</h3>
                <p className="text-sm text-muted-foreground">Filed by {dispute.disputant}</p>
              </div>
              <Badge tone={dispute.status === "resolved" ? "green" : "yellow"}>{dispute.status}</Badge>
            </div>
            <div className="bg-secondary/50 rounded-lg p-3">
              <p className="text-sm font-medium mb-1">Reason: {dispute.reason}</p>
              <p className="text-xs text-muted-foreground">Evidence: {dispute.evidence}</p>
            </div>
            {dispute.status !== "resolved" && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => handleResolve(dispute.id, true)}>
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Accept
                </Button>
                <Button size="sm" variant="destructive" onClick={() => handleResolve(dispute.id, false)}>
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
