import sharp from "sharp";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { CachedImage } from "./classificationTypes";

export class ImageProcessor {
  private s3Client: S3Client;
  private s3Bucket: string;
  private s3Cache: Map<string, CachedImage> = new Map();
  private readonly S3_CACHE_TTL = 1000 * 60 * 30; // 30 minutes
  private readonly MAX_S3_CACHE_SIZE = 50; // Limit cache size

  constructor(s3Client: S3Client, s3Bucket: string) {
    this.s3Client = s3Client;
    this.s3Bucket = s3Bucket;
  }

  /**
   * Extract S3 key from image URL
   */
  extractS3Key(imageUrl: string): string {
    try {
      const urlObj = new URL(imageUrl);
      // Strip any leading slash for consistent key format
      return urlObj.pathname.startsWith("/")
        ? urlObj.pathname.substring(1)
        : urlObj.pathname;
    } catch (e) {
      // If URL parsing fails, assume the URL is the key
      return imageUrl;
    }
  }

  /**
   * Get optimized image data from S3 with adaptive quality
   */
  async getOptimizedImageFromS3(key: string): Promise<Buffer> {
    console.log(`[S3] Fetching image: ${key}`);
    try {
      // Check S3 cache first
      const now = Date.now();
      if (this.s3Cache.has(key)) {
        const cached = this.s3Cache.get(key)!;
        if (now - cached.timestamp < this.S3_CACHE_TTL) {
          console.log(
            `[S3] Cache hit for ${key}, size: ${cached.buffer.length} bytes`,
          );
          return cached.buffer;
        } else {
          // Expired, remove from cache
          console.log(`[S3] Cache expired for ${key}`);
          this.s3Cache.delete(key);
        }
      }
      console.log(`[S3] Cache miss for ${key}`);

      // Try a faster approach first - get a partial range of the image
      try {
        const command = new GetObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Range: "bytes=0-4194304", // First 4MB - enough for most images
        });

        console.log(`[S3] Sending partial range request (0-4MB) for ${key}`);
        const startTime = Date.now();
        const response = await this.s3Client.send(command);
        const duration = Date.now() - startTime;
        console.log(`[S3] Partial range request completed in ${duration}ms`);

        if (response.Body) {
          console.log(`[S3] Processing response body stream`);
          // Convert stream to buffer efficiently
          const chunks: Buffer[] = [];
          for await (const chunk of response.Body as any) {
            chunks.push(Buffer.from(chunk));
          }

          const originalBuffer = Buffer.concat(chunks);
          console.log(
            `[S3] Stream converted to buffer, size: ${originalBuffer.length} bytes`,
          );

          // Try to process this partial image with adaptive quality
          try {
            const resizedBuffer =
              await this.resizeImageAdaptively(originalBuffer);

            // Cache the resized image
            this.updateCache(key, resizedBuffer, now);
            return resizedBuffer;
          } catch (resizeError) {
            // If partial image couldn't be processed, fall back to full image
            console.warn(
              `Partial image processing failed for ${key}, getting full image: ${resizeError}`,
            );
            // Continue to full image download below
          }
        }
      } catch (rangeError) {
        // Range request failed, fall back to full image
        console.warn(
          `Range request failed for ${key}, getting full image: ${rangeError}`,
        );
      }

      // Fall back to getting the full image if needed
      const fullCommand = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      const fullResponse = await this.s3Client.send(fullCommand);

      if (!fullResponse.Body) {
        throw new Error("Empty response from S3");
      }

      // Convert stream to buffer
      const fullChunks: Buffer[] = [];
      for await (const chunk of fullResponse.Body as any) {
        fullChunks.push(Buffer.from(chunk));
      }

      const fullBuffer = Buffer.concat(fullChunks);

      // Resize the full image adaptively
      const resizedBuffer = await this.resizeImageAdaptively(fullBuffer);

      // Cache the resized image
      this.updateCache(key, resizedBuffer, now);

      return resizedBuffer;
    } catch (error) {
      console.error("Error getting image from S3:", error);
      throw new Error(`Failed to get image from S3: ${error}`);
    }
  }

  /**
   * Resize image with adaptive quality settings based on image size
   */
  private async resizeImageAdaptively(buffer: Buffer): Promise<Buffer> {
    try {
      // Get image metadata
      const metadata = await sharp(buffer).metadata();
      const width = metadata.width || 0;
      const height = metadata.height || 0;

      // Determine optimal resize dimensions
      // For very large images, use larger target dimensions to preserve detail
      let targetSize = 400;
      let targetQuality = 70;

      if (width > 3000 || height > 3000) {
        targetSize = 600;
        targetQuality = 65;
      } else if (width < 800 || height < 800) {
        // For smaller images, use higher quality to preserve detail
        targetQuality = 85;
      }

      // Use sharp to resize the image
      return await sharp(buffer)
        .resize(targetSize, targetSize, { fit: "inside" })
        .jpeg({ quality: targetQuality })
        .toBuffer();
    } catch (error) {
      console.error("Error resizing image:", error);
      // If resizing fails, return original buffer as fallback
      return buffer;
    }
  }

  /**
   * Update the cache with a new image buffer
   */
  private updateCache(key: string, buffer: Buffer, timestamp: number): void {
    // Remove oldest item if cache is full
    if (this.s3Cache.size >= this.MAX_S3_CACHE_SIZE) {
      const oldestKey = this.s3Cache.keys().next().value;
      this.s3Cache.delete(oldestKey as string);
    }

    this.s3Cache.set(key, { buffer, timestamp });
  }
}
