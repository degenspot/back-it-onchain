'use client';

/**
 * Avatar selection + crop state (FE-29).
 *
 * Loads a file via FileReader, validates it (type/size), and lets the caller
 * crop a square region via the canvas API. The IPFS upload is optimistic (mock).
 */

import * as React from 'react';

export const AVATAR_MAX_BYTES = 2 * 1024 * 1024; // 2MB
export const AVATAR_ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export type AvatarCropShape = { x: number; y: number; size: number };

export interface CropResult {
  /** data URL of the cropped square, ready for preview or upload. */
  dataUrl: string;
  /** Outgoing Blob for the (mock) IPFS upload. */
  blob: Blob;
}

export interface UseAvatarCropResult {
  sourceUrl: string | null;
  error: string | null;
  crop: AvatarCropShape | null;
  selectFile: (file: File | undefined | null) => void;
  cropSquare: (size: number, shape?: AvatarCropShape) => Promise<CropResult | null>;
  /** Optimistic IPFS CID preview (mock). */
  mockCid: (blob: Blob) => string;
}

export function validateAvatar(file: File): string | null {
  if (!AVATAR_ALLOWED_TYPES.includes(file.type)) {
    return 'Only JPG, PNG or WEBP images are allowed';
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return 'Image must be 2MB or smaller';
  }
  return null;
}

/** Deterministic pseudo-CID from a blob so the preview is stable (mock). */
export function mockCidFor(blob: Blob): string {
  let hash = 0;
  const text = `${blob.size}:${blob.type}`;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `bafybeig${hash.toString(16).padStart(8, '0')}`;
}

export function useAvatarCrop(): UseAvatarCropResult {
  const [sourceUrl, setSourceUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [crop, setCrop] = React.useState<AvatarCropShape | null>(null);

  const selectFile = React.useCallback((file: File | undefined | null) => {
    if (!file) return;

    const validationError = validateAvatar(file);
    if (validationError) {
      setError(validationError);
      setSourceUrl(null);
      setCrop(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      setSourceUrl(typeof reader.result === 'string' ? reader.result : null);
      setError(null);
      setCrop(null);
    };
    reader.onerror = () => setError('Could not read the selected file');
    reader.readAsDataURL(file);
  }, []);

  const cropSquare = React.useCallback(
    (size: number, shape?: AvatarCropShape): Promise<CropResult | null> => {
      if (!sourceUrl || size <= 0) return Promise.resolve(null);
      const region = shape ?? { x: 0, y: 0, size: Math.max(size, 1) };

      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return Promise.resolve(null);

      return new Promise<CropResult | null>((resolve) => {
        const image = new Image();
        image.onload = () => {
          ctx.drawImage(image, region.x, region.y, region.size, region.size, 0, 0, size, size);
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                resolve(null);
                return;
              }
              const dataUrl = canvas.toDataURL('image/webp', 0.9);
              setCrop(region);
              resolve({ dataUrl, blob });
            },
            'image/webp',
            0.9,
          );
        };
        image.onerror = () => resolve(null);
        image.src = sourceUrl;
      });
    },
    [sourceUrl],
  );

  return { sourceUrl, error, crop, selectFile, cropSquare, mockCid: mockCidFor };
}
