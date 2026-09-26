'use client';

import * as React from 'react';
import { ExternalLink, File, Image as ImageIcon, ShieldAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EvidencePreviewProps {
  cid?: string;
  url?: string;
  mimeType?: string;
  title?: string;
  className?: string;
}

function safeEvidenceUrl(cid?: string, url?: string): string | null {
  if (url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'https:') return parsed.toString();
    } catch {
      return null;
    }
  }
  if (!cid || !/^[a-zA-Z0-9]+$/.test(cid)) return null;
  return `https://ipfs.io/ipfs/${cid}`;
}

export function EvidencePreview({ cid, url, mimeType, title = 'Evidence', className }: EvidencePreviewProps) {
  const source = safeEvidenceUrl(cid, url);
  if (!source) {
    return (
      <div className={cn('flex items-center gap-2 rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground', className)}>
        <ShieldAlert className="h-4 w-4" /> Evidence URL is not trusted or is invalid.
      </div>
    );
  }

  const isImage = mimeType?.startsWith('image/') || /\.(png|jpe?g|gif|webp|svg)(?:$|\?)/i.test(source);

  return (
    <figure className={cn('overflow-hidden rounded-lg border border-border bg-background', className)}>
      {isImage ? (
        <img src={source} alt={title} className="max-h-64 w-full object-contain" loading="lazy" />
      ) : (
        <div className="flex min-h-24 items-center justify-center gap-2 p-5 text-sm text-muted-foreground">
          <File className="h-5 w-5" /> {title}
        </div>
      )}
      <figcaption className="flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs">
        <span className="truncate text-muted-foreground">{cid || source}</span>
        <a href={source} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 hover:text-primary">
          Open <ExternalLink className="h-3 w-3" />
        </a>
      </figcaption>
    </figure>
  );
}

export function EvidencePreviewIcon() {
  return <ImageIcon aria-hidden="true" className="h-4 w-4" />;
}
