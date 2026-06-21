import imageCompression from 'browser-image-compression';

/** حد آمن لحجم base64 في JSON (بايت تقريبية) */
const TARGET_MAX_BYTES = 450_000;

export type CompressOrderLineImageResult = {
  dataUrl: string;
  /** حجم تقريبي بعد الضغط */
  bytes: number;
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.readAsDataURL(blob);
  });
}

function estimateDataUrlBytes(dataUrl: string): number {
  const base64 = dataUrl.split(',')[1] ?? '';
  return Math.ceil((base64.length * 3) / 4);
}

function isHeicLike(file: File): boolean {
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  return type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif');
}

/**
 * ضغط صورة سطر الطلبية — مناسبة لصور الكاميرا على الجوال.
 * تستخدم browser-image-compression (تصحيح اتجاه EXIF + ضغط تدريجي).
 */
export async function compressOrderLineImage(file: File): Promise<CompressOrderLineImageResult> {
  if (!file.type.startsWith('image/') && !isHeicLike(file)) {
    throw new Error('INVALID_IMAGE');
  }
  if (isHeicLike(file)) {
    throw new Error('HEIC_UNSUPPORTED');
  }

  const attempts: Array<{ maxSizeMB: number; maxWidthOrHeight: number; initialQuality: number }> = [
    { maxSizeMB: 0.45, maxWidthOrHeight: 1280, initialQuality: 0.82 },
    { maxSizeMB: 0.32, maxWidthOrHeight: 1024, initialQuality: 0.78 },
    { maxSizeMB: 0.22, maxWidthOrHeight: 860, initialQuality: 0.72 },
    { maxSizeMB: 0.15, maxWidthOrHeight: 720, initialQuality: 0.68 },
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i += 1) {
    const opts = attempts[i];
    try {
      const compressed = await imageCompression(file, {
        maxSizeMB: opts.maxSizeMB,
        maxWidthOrHeight: opts.maxWidthOrHeight,
        initialQuality: opts.initialQuality,
        useWebWorker: typeof Worker !== 'undefined',
        fileType: 'image/jpeg',
        preserveExif: false,
        alwaysKeepResolution: false,
      });

      const dataUrl = await blobToDataUrl(compressed);
      if (!dataUrl.startsWith('data:image/')) {
        throw new Error('COMPRESS_FAILED');
      }

      const bytes = estimateDataUrlBytes(dataUrl);
      if (bytes <= TARGET_MAX_BYTES || i === attempts.length - 1) {
        return { dataUrl, bytes };
      }
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('COMPRESS_FAILED');
}

export function compressOrderLineImageErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    if (err.message === 'HEIC_UNSUPPORTED') {
      return 'صيغة HEIC من آيفون غير مدعومة مباشرة — اختر «أكثر توافقاً» من إعدادات الكاميرا أو اختر الصورة من المعرض بعد تحويلها';
    }
    if (err.message === 'INVALID_IMAGE') {
      return 'الملف المختار ليس صورة';
    }
  }
  return 'تعذر ضغط الصورة — جرّب إعادة التصوير أو اختيار صورة من المعرض';
}
