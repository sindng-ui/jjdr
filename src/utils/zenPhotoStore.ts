/**
 * Async IndexedDB photo store & client-side HD image optimizer for Zen Chill Custom Photo backdrop.
 * Stores binary Blobs (no base64 overhead, no 5MB localStorage stall) resized to <= 1920x1080 WebP/JPEG.
 */

export interface StoredChillPhoto {
  id: string;
  name: string;
  blob: Blob;
  width: number;
  height: number;
  sizeBytes: number;
  updatedAt: number;
}

export interface StoredChillPhotoMeta {
  name: string;
  width: number;
  height: number;
  sizeBytes: number;
  updatedAt: number;
}

const DB_NAME = "jjdr-zen-assets";
const DB_VERSION = 1;
const STORE_NAME = "chill_photos";
const ACTIVE_KEY = "active";

export const MAX_RAW_PHOTO_BYTES = 30 * 1024 * 1024; // 30 MB input guard
export const MAX_PHOTO_WIDTH = 1920;
export const MAX_PHOTO_HEIGHT = 1080;

/**
 * Computes aspect-preserving target dimensions capped within maxWidth x maxHeight.
 * Never upscales images smaller than the cap.
 */
export function computePhotoFitDimensions(
  srcWidth: number,
  srcHeight: number,
  maxWidth = MAX_PHOTO_WIDTH,
  maxHeight = MAX_PHOTO_HEIGHT
): { width: number; height: number } {
  if (
    !Number.isFinite(srcWidth) ||
    !Number.isFinite(srcHeight) ||
    srcWidth <= 0 ||
    srcHeight <= 0
  ) {
    return { width: maxWidth, height: maxHeight };
  }
  const scale = Math.min(1, maxWidth / srcWidth, maxHeight / srcHeight);
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
  };
}

export function validatePhotoFile(file: File): string | null {
  if (!file.type.startsWith("image/")) {
    return "이미지 파일(PNG, JPG, WebP 등)만 업로드할 수 있습니다.";
  }
  if (file.size > MAX_RAW_PHOTO_BYTES) {
    return "파일 크기가 너무 큽니다 (최대 30MB 이하).";
  }
  return null;
}

function openPhotoDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this environment."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("Failed to open photo database."));
  });
}

async function decodeImageSource(
  file: File
): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => bitmap.close(),
    };
  }
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("이미지를 디코딩하지 못했습니다."));
      el.src = objectUrl;
    });
    return {
      source: img,
      width: img.naturalWidth || img.width,
      height: img.naturalHeight || img.height,
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality);
  });
}

/**
 * Downscales & re-encodes an uploaded image into a compact HD WebP/JPEG Blob
 * so Zen Chill renders instantaneously with minimal memory footprint.
 */
export async function optimizeChillPhotoFile(file: File): Promise<{
  blob: Blob;
  width: number;
  height: number;
}> {
  const err = validatePhotoFile(file);
  if (err) throw new Error(err);

  const decoded = await decodeImageSource(file);
  try {
    const { width, height } = computePhotoFitDimensions(
      decoded.width,
      decoded.height
    );
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { blob: file, width: decoded.width, height: decoded.height };
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(decoded.source, 0, 0, width, height);

    const webp = await canvasToBlob(canvas, "image/webp", 0.86);
    if (webp && webp.size > 0) {
      return { blob: webp, width, height };
    }
    const jpeg = await canvasToBlob(canvas, "image/jpeg", 0.88);
    if (jpeg && jpeg.size > 0) {
      return { blob: jpeg, width, height };
    }
    return { blob: file, width: decoded.width, height: decoded.height };
  } finally {
    decoded.cleanup();
  }
}

export async function saveChillPhoto(file: File): Promise<StoredChillPhoto> {
  const { blob, width, height } = await optimizeChillPhotoFile(file);
  const record: StoredChillPhoto = {
    id: ACTIVE_KEY,
    name: file.name || "custom-photo",
    blob,
    width,
    height,
    sizeBytes: blob.size,
    updatedAt: Date.now(),
  };

  const db = await openPhotoDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("사진을 저장하지 못했습니다."));
    });
  } finally {
    db.close();
  }
  return record;
}

export async function loadChillPhoto(): Promise<StoredChillPhoto | null> {
  try {
    const db = await openPhotoDb();
    try {
      return await new Promise<StoredChillPhoto | null>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).get(ACTIVE_KEY);
        req.onsuccess = () =>
          resolve((req.result as StoredChillPhoto | undefined) ?? null);
        req.onerror = () => reject(req.error);
      });
    } finally {
      db.close();
    }
  } catch {
    return null;
  }
}

export async function clearChillPhoto(): Promise<void> {
  try {
    const db = await openPhotoDb();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(ACTIVE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  } catch {
    // Ignore cleanup errors when IndexedDB unavailable
  }
}
