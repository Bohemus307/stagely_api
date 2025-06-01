import sharp from "sharp";
import {
  S3Client,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { CachedImage } from "./classificationTypes";
import { DetectedLabel } from "../../../incidents/comparison/comparisonTypes";

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
   * Draw bounding boxes on an image and save it to S3
   */
  async drawBoundingBoxesOnImage(
    originalImageKey: string,
    detectedLabels: DetectedLabel[],
    propertyId: number,
    userId: string,
  ): Promise<string> {
    try {
      // Get the original image
      const originalBuffer =
        await this.getOriginalImageFromS3(originalImageKey);

      // Create a sharp instance for image manipulation
      const image = sharp(originalBuffer);

      // Get image metadata
      const metadata = await image.metadata();
      const { width, height } = metadata;

      if (!width || !height) {
        throw new Error("Could not determine image dimensions");
      }

      // Create an SVG overlay with bounding boxes
      const svgBuffer = Buffer.from(
        this.createBoundingBoxSVG(width, height, detectedLabels),
      );

      // Composite the SVG overlay on the original image
      const labeledBuffer = await image
        .composite([{ input: svgBuffer, top: 0, left: 0 }])
        .jpeg({ quality: 90 })
        .toBuffer();

      // Generate a path for the labeled image
      const timestamp = new Date().getTime();
      const labeledKey = `incidents/${propertyId}/${userId}/${timestamp}_labeled.jpg`;

      // Upload the labeled image to S3
      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.s3Bucket,
          Key: labeledKey,
          Body: labeledBuffer,
          ContentType: "image/jpeg",
        }),
      );

      // Return the URL to the labeled image
      return `https://${this.s3Bucket}.s3.amazonaws.com/${labeledKey}`;
    } catch (error) {
      console.error("Error drawing bounding boxes on image:", error);
      throw new Error(`Failed to draw bounding boxes: ${error}`);
    }
  }

  /**
   * Get the original (non-optimized) image from S3
   */
  private async getOriginalImageFromS3(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.s3Bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new Error("Empty response from S3");
      }

      // Convert stream to buffer
      const chunks: Buffer[] = [];
      for await (const chunk of response.Body as any) {
        chunks.push(Buffer.from(chunk));
      }

      return Buffer.concat(chunks);
    } catch (error) {
      console.error("Error getting original image from S3:", error);
      throw new Error(`Failed to get original image: ${error}`);
    }
  }

  /**
   * Create an SVG with bounding boxes and labels
   */
  private createBoundingBoxSVG(
    width: number,
    height: number,
    detectedLabels: DetectedLabel[],
  ): string {
    // Start SVG
    let svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">`;

    // Add bounding boxes and labels
    for (const label of detectedLabels) {
      if (label.boundingBox) {
        const box = label.boundingBox;
        const x = Math.floor(box.left * width);
        const y = Math.floor(box.top * height);
        const boxWidth = Math.floor(box.width * width);
        const boxHeight = Math.floor(box.height * height);

        // Determine color based on confidence or category
        let color = "rgba(255, 0, 0, 0.9)"; // Default red with higher opacity
        let boxStrokeColor = "rgba(255, 0, 0, 1)"; // Solid color for box stroke

        if (label.category) {
          // Assign colors by category
          switch (label.category) {
            case "Damage":
              color = "rgba(255, 0, 0, 0.9)"; // Red
              boxStrokeColor = "rgba(255, 0, 0, 1)";
              break;
            case "Furniture":
              color = "rgba(0, 255, 0, 0.9)"; // Green
              boxStrokeColor = "rgba(0, 255, 0, 1)";
              break;
            case "Appliances":
              color = "rgba(0, 0, 255, 0.9)"; // Blue
              boxStrokeColor = "rgba(0, 0, 255, 1)";
              break;
            case "Fixtures":
              color = "rgba(255, 165, 0, 0.9)"; // Orange
              boxStrokeColor = "rgba(255, 165, 0, 1)";
              break;
            default:
              color = "rgba(255, 255, 0, 0.9)"; // Yellow
              boxStrokeColor = "rgba(255, 255, 0, 1)";
          }
        } else if (label.confidence > 0.8) {
          color = "rgba(0, 255, 0, 0.9)"; // Green for high confidence
          boxStrokeColor = "rgba(0, 255, 0, 1)";
        } else if (label.confidence > 0.6) {
          color = "rgba(255, 165, 0, 0.9)"; // Orange for medium confidence
          boxStrokeColor = "rgba(255, 165, 0, 1)";
        }

        // Add rectangle for bounding box with thicker stroke
        svg += `<rect x="${x}" y="${y}" width="${boxWidth}" height="${boxHeight}" 
              stroke="${boxStrokeColor}" stroke-width="8" fill="none" />`;

        // Calculate a much larger text size based on image dimensions
        const fontSize = Math.max(24, Math.min(36, Math.floor(width / 30)));

        // Calculate label position - try to place it above the box if possible
        // or inside the top of the box if near the top of the image
        const textY = y < 50 ? y + 40 : y - 15;

        // Increase label box width and height to accommodate larger text
        const labelWidth = Math.max(
          200,
          label.name.length * fontSize * 0.7 + 90,
        );
        const labelHeight = Math.max(40, fontSize + 16);

        // Use a dark background with outline for better contrast
        const labelBoxY = textY - fontSize;

        // Add black outline around label background for better visibility
        svg += `<rect x="${x - 2}" y="${labelBoxY - 2}" width="${labelWidth + 4}" height="${labelHeight + 4}" 
              fill="black" />`;

        // Add background for better label readability
        svg += `<rect x="${x}" y="${labelBoxY}" width="${labelWidth}" height="${labelHeight}" 
              fill="${color}" />`;

        // Add label text with confidence - using larger font size with black outline for better readability
        const confidencePercent = Math.round(label.confidence * 100);

        // Text with black outline for better visibility against any background
        svg += `
          <text x="${x + 5}" y="${textY}" 
                font-family="Arial" font-weight="bold" font-size="${fontSize}px"
                style="filter: drop-shadow(1px 1px 2px rgba(0,0,0,0.9))">
            <tspan fill="yellow">${label.name} (${confidencePercent}%)</tspan>
          </text>
        `;
      }
    }

    svg += `</svg>`;
    return svg;
  }

  /**
   * Get optimized image data from S3 with adaptive quality
   */
  async getOptimizedImageFromS3(key: string): Promise<Buffer> {
    try {
      // Check S3 cache first
      const now = Date.now();
      if (this.s3Cache.has(key)) {
        const cached = this.s3Cache.get(key)!;
        if (now - cached.timestamp < this.S3_CACHE_TTL) {
          return cached.buffer;
        } else {
          this.s3Cache.delete(key);
        }
      }

      // Try a faster approach first - get a partial range of the image
      try {
        const command = new GetObjectCommand({
          Bucket: this.s3Bucket,
          Key: key,
          Range: "bytes=0-4194304", // First 4MB - enough for most images
        });

        const startTime = Date.now();
        const response = await this.s3Client.send(command);
        const duration = Date.now() - startTime;

        if (response.Body) {
          // Convert stream to buffer efficiently
          const chunks: Buffer[] = [];
          for await (const chunk of response.Body as any) {
            chunks.push(Buffer.from(chunk));
          }

          const originalBuffer = Buffer.concat(chunks);

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
