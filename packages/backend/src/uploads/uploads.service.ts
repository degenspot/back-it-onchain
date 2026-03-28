import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import * as sharp from 'sharp';
import { IpfsService } from '../ipfs/ipfs.service';

export interface ImageUploadResult {
  cid: string;
  /** Public IPFS gateway URL for convenience */
  url: string;
  /** Processed image size in bytes */
  size: number;
  /** Final width after resize */
  width: number;
  /** Final height after resize */
  height: number;
}

export interface ImageProcessingOptions {
  /** Max pixel dimension on either axis (default 400) */
  maxDimension?: number;
  /** Max output file size in bytes (default 200 KB) */
  maxSizeBytes?: number;
}

const SUPPORTED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DEFAULT_MAX_DIMENSION = 400;
const DEFAULT_MAX_SIZE_BYTES = 200 * 1024; // 200 KB

@Injectable()
export class UploadsService {
  private readonly logger = new Logger(UploadsService.name);

  constructor(private readonly ipfsService: IpfsService) {}

  /**
   * Process an uploaded image entirely in-memory (no disk I/O):
   *   1. Validate MIME type
   *   2. Resize to fit within maxDimension × maxDimension (preserves aspect ratio)
   *   3. Re-compress as JPEG (best size/quality ratio for photos)
   *   4. Enforce maxSizeBytes — iteratively lower quality until it fits
   *   5. Pin the result to IPFS and return the CID + metadata
   */
  async processAndUploadImage(
    buffer: Buffer,
    mimetype: string,
    originalname: string,
    options: ImageProcessingOptions = {},
  ): Promise<ImageUploadResult> {
    const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
    const maxSizeBytes = options.maxSizeBytes ?? DEFAULT_MAX_SIZE_BYTES;

    if (!SUPPORTED_MIME_TYPES.has(mimetype)) {
      throw new BadRequestException(
        `Unsupported image type "${mimetype}". Allowed: jpeg, png, webp, gif`,
      );
    }

    // ── Step 1: Resize ───────────────────────────────────────────────────────
    let pipeline = sharp(buffer).resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',        // never upscale, never crop
      withoutEnlargement: true,
    });

    // ── Step 2: Compress — start at quality 85, lower if needed ─────────────
    let quality = 85;
    let processed: Buffer;
    let metadata: sharp.OutputInfo;

    do {
      const result = await pipeline
        .clone()
        .jpeg({ quality, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      processed = result.data;
      metadata = result.info;

      if (processed.length <= maxSizeBytes) break;

      quality -= 10;
      if (quality < 20) {
        throw new PayloadTooLargeException(
          `Image cannot be compressed below ${maxSizeBytes} bytes at minimum quality`,
        );
      }
    } while (processed.length > maxSizeBytes);

    this.logger.log(
      `Image processed: ${processed.length} bytes, ${metadata.width}×${metadata.height}, quality=${quality}`,
    );

    // ── Step 3: Pin to IPFS ──────────────────────────────────────────────────
    const ext = '.jpg';
    const filename = originalname.replace(/\.[^.]+$/, ext) || `image${ext}`;
    const cid = await this.ipfsService.pin(processed, filename);

    return {
      cid,
      url: `https://ipfs.io/ipfs/${cid}`,
      size: processed.length,
      width: metadata.width,
      height: metadata.height,
    };
  }
}
