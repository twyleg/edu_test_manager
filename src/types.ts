export interface DriveItem {
  id: string;
  name: string;
  mimeType: string;
}

export interface PageScan {
  pageNumber: number;
  hasQr: boolean;
  skipped?: boolean;
  rotation?: number;
  thumbnailUrl: string;
}

export interface PageRange {
  start: number;
  end: number;
}

export interface ExamFile extends PageRange {
  pageNumbers: number[];
  name: string;
  blob: Blob;
  previewUrl: string;
  thumbnailUrl: string;
  driveId?: string;
  uploaded: boolean;
  error?: string;
}
