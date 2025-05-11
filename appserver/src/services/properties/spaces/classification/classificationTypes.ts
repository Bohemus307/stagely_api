import { SpaceType, Prisma } from "@prisma/client";

// Classification result interface
export interface ClassificationResult {
  spaceType: SpaceType;
  confidenceScore: number;
  labels: string[];
  featureVector: Prisma.JsonValue;
}

// S3 client configuration interface
export interface S3Config {
  client: any; // S3Client
  bucket: string;
  region: string;
}

// Image cache item interface
export interface CachedImage {
  buffer: Buffer;
  timestamp: number;
}

// Label mapping interface
export interface LabelMapping {
  [key: string]: SpaceType;
}

// Additional space indicators for fuzzy matching
export interface SpaceIndicators {
  [key: string]: {
    keywords: string[];
    weight: number;
  };
}
