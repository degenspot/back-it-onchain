'use client';

import * as React from 'react';
import Image from 'next/image';
import { cn } from '@/lib/utils';
import { useAvatarCrop } from '@/src/hooks/useAvatarCrop';

export interface AvatarUploaderProps {
  onUpload?: (payload: { dataUrl: string; cid: string }) => void;
  size?: number;
  className?: string;
}

export function AvatarUploader({ onUpload, size = 96, className }: AvatarUploaderProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { sourceUrl, error, selectFile, cropSquare, mockCid } = useAvatarCrop();
  const [preview, setPreview] = React.useState<string | null>(null);
  const [cid, setCid] = React.useState<string | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    selectFile(file ?? null);
    e.target.value = '';
  };

  const handleCrop = async () => {
    const result = await cropSquare(size);
    if (!result) return;
    setPreview(result.dataUrl);
    const mock = mockCid(result.blob);
    setCid(mock);
    onUpload?.({ dataUrl: result.dataUrl, cid: mock });
  };

  return (
    <div className={cn('flex flex-col items-center gap-4', className)}>
      <div
        className={cn('relative flex items-center justify-center rounded-full border-4 border-border', error && 'border-destructive/40')}
        style={{ width: size, height: size }}
        data-testid="avatar-canvas"
      >
        {preview ?? sourceUrl ? (
          <Image
            src={preview ?? sourceUrl ?? ''}
            alt="avatar preview"
            fill
            unoptimized
            sizes={`${size}px`}
            className="rounded-full object-cover"
            data-testid="avatar-preview"
          />
        ) : (
          <span className="text-3xl text-muted-foreground">+</span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
        >
          Choose image
        </button>
        {sourceUrl ? (
          <button
            type="button"
            onClick={handleCrop}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium transition-colors hover:bg-secondary/50"
          >
            Crop & preview
          </button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleChange}
        className="hidden"
        data-testid="avatar-input"
      />

      {error ? (
        <p className="text-xs text-destructive" data-testid="avatar-error">
          {error}
        </p>
      ) : null}

      {cid ? (
        <p className="text-xs text-muted-foreground" data-testid="avatar-cid">
          IPFS <span className="font-mono">ipfs://{cid}</span>
        </p>
      ) : null}
    </div>
  );
}
