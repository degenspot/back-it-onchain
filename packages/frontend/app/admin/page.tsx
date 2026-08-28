"use client";

import { useState, useEffect } from "react";
import { Shield, Flag, AlertTriangle, Eye, EyeOff, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { FlaggedTable } from "@/components/admin/FlaggedTable";
import { DisputeQueue } from "@/components/admin/DisputeQueue";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";

type AdminTab = "flagged" | "disputes";

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>("flagged");
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [isChecking, setIsChecking] = useState(true);
  
  useEffect(() => {
    // Client-side admin check
    const checkAdmin = async () => {
      try {
        // Check wallet connection and admin role
        setIsAdmin(true); // Mock for now
      } catch {
        setIsAdmin(false);
      } finally {
        setIsChecking(false);
      }
    };
    checkAdmin();
  }, []);
  
  if (isChecking) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }
  
  if (!isAdmin) {
    return (
      <AppLayout>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Shield className="h-12 w-12 text-muted-foreground mb-4" />
          <h2 className="text-xl font-bold mb-2">Access Denied</h2>
          <p className="text-muted-foreground">You do not have admin privileges.</p>
        </div>
      </AppLayout>
    );
  }
  
  return (
    <AppLayout>
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between px-2">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            Moderation Dashboard
          </h1>
        </div>
        
        <div className="flex gap-3 border-b border-border px-2">
          <button
            onClick={() => setActiveTab("flagged")}
            className={`pb-3 border-b-2 font-bold transition-colors ${
              activeTab === "flagged"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <Flag className="h-4 w-4 inline mr-1" />
            Flagged Calls
          </button>
          <button
            onClick={() => setActiveTab("disputes")}
            className={`pb-3 border-b-2 font-bold transition-colors ${
              activeTab === "disputes"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <AlertTriangle className="h-4 w-4 inline mr-1" />
            Dispute Queue
          </button>
        </div>
        
        {activeTab === "flagged" && <FlaggedTable />}
        {activeTab === "disputes" && <DisputeQueue />}
      </div>
    </AppLayout>
  );
}
