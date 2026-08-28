"use client";

import { useState, useCallback } from "react";
import { Share2, Copy, Check, ExternalLink, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";

interface ShareCallProps {
  callId: string;
  title: string;
}

export function ShareCall({ callId, title }: ShareCallProps) {
  const [copied, setCopied] = useState(false);
  
  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/calls/${callId}`
    : "";
  
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textarea = document.createElement("textarea");
      textarea.value = shareUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [shareUrl]);
  
  const handleNativeShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${title} | BackIT`,
          text: `Check out this prediction: ${title}`,
          url: shareUrl,
        });
      } catch {
        // User cancelled
      }
    }
  }, [title, shareUrl]);
  
  const handleTwitterShare = useCallback(() => {
    const text = encodeURIComponent(`Check out this prediction: ${title}`);
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, "_blank");
  }, [title, shareUrl]);
  
  const handleTelegramShare = useCallback(() => {
    const text = encodeURIComponent(`Check out this prediction: ${title} — ${shareUrl}`);
    window.open(`https://t.me/share/url?text=${text}`, "_blank");
  }, [title, shareUrl]);
  
  return (
    <div className="flex items-center gap-2" data-testid="share-call">
      {typeof navigator !== "undefined" && "share" in navigator ? (
        <Tooltip content="Share">
          <Button variant="ghost" size="icon" onClick={handleNativeShare}>
            <Share2 className="h-4 w-4" />
          </Button>
        </Tooltip>
      ) : null}
      
      <Tooltip content={copied ? "Copied!" : "Copy link"}>
        <Button variant="ghost" size="icon" onClick={handleCopy}>
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </Tooltip>
      
      <Tooltip content="Share on X">
        <Button variant="ghost" size="icon" onClick={handleTwitterShare}>
          <ExternalLink className="h-4 w-4" />
        </Button>
      </Tooltip>
      
      <Tooltip content="Share on Telegram">
        <Button variant="ghost" size="icon" onClick={handleTelegramShare}>
          <MessageCircle className="h-4 w-4" />
        </Button>
      </Tooltip>
    </div>
  );
}
