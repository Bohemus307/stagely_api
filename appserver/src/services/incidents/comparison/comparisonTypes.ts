import { SpaceType, Prisma, IncidentSeverity } from "@prisma/client";
import { RekognitionClient } from "@aws-sdk/client-rekognition";
import { S3Client } from "@aws-sdk/client-s3";

// Core incident detection result
export interface IncidentDetectionResult {
  incidentType: string;
  severity: IncidentSeverity;
  confidenceScore: number;
  spaceType: SpaceType | null;
  detectedLabels: DetectedLabel[];
  changes: DetectedChange[];
  featureVector: Prisma.JsonValue;
  labeledImageUrl?: string; // Add this field
}

// Label detected in an image
export interface DetectedLabel {
  name: string;
  confidence: number;
  category?: string;
  parentNames?: string[];
  boundingBox?: BoundingBox;
}

// Represents a change detected between two images
export interface DetectedChange {
  changeType: ChangeType;
  objectName: string;
  confidence: number;
  description: string;
  boundingBox: BoundingBox;
  before?: {
    confidence: number;
    boundingBox: BoundingBox;
  };
  after?: {
    confidence: number;
    boundingBox: BoundingBox;
  };
}

// Types of changes that can be detected
export enum ChangeType {
  ADDED = "added",
  REMOVED = "removed",
  DAMAGED = "damaged",
  MOVED = "moved",
  CHANGED = "changed",
  UNKNOWN = "unknown",
}

// Interface to match AWS Rekognition's BoundingBox structure
export interface RekognitionBoundingBox {
  Left?: number;
  Top?: number;
  Width?: number;
  Height?: number;
}

// Our internal BoundingBox representation with camelCase
export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

// Configuration for image comparison
export interface ComparisonConfig {
  minConfidenceThreshold: number;
  similarityThreshold: number;
  objectMatchThreshold: number;
  damageDetectionSensitivity: number;
}

// S3 client configuration
export interface S3Config {
  client: S3Client; // Properly typed as S3Client
  bucket: string;
  region: string;
}

// Rekognition client configuration - adding a separate interface
export interface RekognitionConfig {
  client: RekognitionClient;
  region: string;
}

// Combined configuration for services that need both
export interface AWSConfig {
  s3Client: S3Client;
  rekognitionClient: RekognitionClient;
  bucket: string;
  region: string;
}

// Types of incidents we can detect
export enum IncidentCategoryType {
  DAMAGE = "damage",
  MISSING_ITEM = "missing_item",
  UNAUTHORIZED_CHANGE = "unauthorized_change",
  CLEANLINESS = "cleanliness",
  MAINTENANCE = "maintenance",
  SAFETY = "safety",
  OTHER = "other",
}

// Mapping of labels to incident types
export interface IncidentLabelMapping {
  [key: string]: {
    incidentType: string;
    severity: IncidentSeverity;
    category: IncidentCategoryType;
    weight: number;
  };
}

// Additional indicators for fuzzy matching
export interface IncidentIndicators {
  [key: string]: {
    keywords: string[];
    weight: number;
    severity: IncidentSeverity;
  };
}
