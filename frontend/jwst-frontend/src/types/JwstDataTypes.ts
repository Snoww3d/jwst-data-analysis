export interface JwstDataModel {
  id: string;
  fileName: string;
  dataType: string;
  uploadDate: string;
  description?: string;
  metadata: Record<string, any>;
  filePath?: string;
  fileSize: number;
  processingStatus: string;
  tags: string[];
  userId?: string;
  isArchived: boolean;
  archivedDate?: string;
  imageInfo?: ImageMetadata;
  sensorInfo?: SensorMetadata;
  processingResults: ProcessingResult[];
}

export interface ImageMetadata {
  width: number;
  height: number;
  format?: string;
  bitDepth?: number;
  channels?: string[];
  statistics?: Record<string, number>;
}

export interface SensorMetadata {
  instrument?: string;
  wavelength?: string;
  dataPoints?: number;
  units?: string;
  observationDate?: string;
  instrumentSettings?: Record<string, any>;
}

export interface ProcessingResult {
  id: string;
  algorithm: string;
  processedDate: string;
  status: string;
  parameters: Record<string, any>;
  results: Record<string, any>;
  outputFilePath?: string;
  errorMessage?: string;
}

export interface ProcessingRequest {
  algorithm: string;
  parameters: Record<string, any>;
} 