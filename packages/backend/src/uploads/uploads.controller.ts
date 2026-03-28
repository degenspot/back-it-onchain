import {
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  Query,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { UploadsService } from './uploads.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploadsService: UploadsService) {}

  /**
   * POST /uploads/image
   *
   * Accepts a multipart/form-data request with a single `image` field.
   * The file is processed entirely in-memory (no disk writes):
   *   - Resized to fit within maxDimension × maxDimension (default 400 px)
   *   - Re-compressed as JPEG targeting ≤ maxSizeKb KB (default 200 KB)
   *   - Pinned to IPFS
   *
   * Query params:
   *   ?maxDimension=400   Maximum width/height in pixels
   *   ?maxSizeKb=200      Maximum output size in kilobytes
   *
   * Returns: { cid, url, size, width, height }
   *
   * @example
   * curl -X POST http://localhost:3001/uploads/image \
   *   -H "Authorization: Bearer <jwt>" \
   *   -F "image=@avatar.png" \
   *   -F "maxDimension=400"
   */
  @Post('image')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),           // keep buffer in RAM — no disk I/O
      limits: {
        fileSize: 10 * 1024 * 1024,       // 10 MB raw upload cap
        files: 1,
      },
      fileFilter: (_req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          cb(new BadRequestException('Only image files are accepted'), false);
        } else {
          cb(null, true);
        }
      },
    }),
  )
  async uploadImage(
    @UploadedFile() file: Express.Multer.File,
    @Query('maxDimension', new DefaultValuePipe(400), ParseIntPipe) maxDimension: number,
    @Query('maxSizeKb', new DefaultValuePipe(200), ParseIntPipe) maxSizeKb: number,
  ) {
    if (!file) {
      throw new BadRequestException('No image file provided (field name: "image")');
    }

    return this.uploadsService.processAndUploadImage(
      file.buffer,
      file.mimetype,
      file.originalname,
      {
        maxDimension,
        maxSizeBytes: maxSizeKb * 1024,
      },
    );
  }
}
