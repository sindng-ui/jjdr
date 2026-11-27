import { describe, expect, it } from "vitest";
import {
  computePhotoFitDimensions,
  MAX_RAW_PHOTO_BYTES,
  validatePhotoFile,
} from "./zenPhotoStore";

describe("zenPhotoStore helpers", () => {
  it("downscales large landscape and portrait images while preserving aspect ratio", () => {
    // 4K 16:9 -> 1920x1080
    expect(computePhotoFitDimensions(3840, 2160)).toEqual({
      width: 1920,
      height: 1080,
    });
    // Tall portrait 2000x4000 -> capped by height 1080 -> 540x1080
    expect(computePhotoFitDimensions(2000, 4000)).toEqual({
      width: 540,
      height: 1080,
    });
    // Ultra-wide 4000x1000 -> capped by width 1920 -> 1920x480
    expect(computePhotoFitDimensions(4000, 1000)).toEqual({
      width: 1920,
      height: 480,
    });
  });

  it("never upscales images already within bounds", () => {
    expect(computePhotoFitDimensions(1280, 720)).toEqual({
      width: 1280,
      height: 720,
    });
    expect(computePhotoFitDimensions(800, 600)).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("validates image MIME type and size guard", () => {
    const valid = new File(["abc"], "beach.jpg", { type: "image/jpeg" });
    expect(validatePhotoFile(valid)).toBeNull();

    const notImg = new File(["abc"], "doc.txt", { type: "text/plain" });
    expect(validatePhotoFile(notImg)).not.toBeNull();

    const oversized = {
      type: "image/png",
      size: MAX_RAW_PHOTO_BYTES + 1,
    } as File;
    expect(validatePhotoFile(oversized)).not.toBeNull();
  });
});
