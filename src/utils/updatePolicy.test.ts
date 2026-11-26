import { describe, expect, it } from "vitest";
import {
  buildMockUpdateResult,
  formatBytes,
  formatReleaseDate,
  normalizeVersion,
  resolveReleaseNotesMarkdown,
  shouldShowUpdatePopup,
} from "./updatePolicy";
import type { UpdateCheckResult } from "../types/domain";

const sampleUpdate: UpdateCheckResult = {
  current_version: "0.3.0",
  latest_version: "0.4.0",
  has_update: true,
  release_name: "jjdr v0.4.0",
  release_notes: "## What's New\n- Feature A",
  release_url: "https://github.com/sindng-ui/jjdr/releases/tag/v0.4.0",
  published_at: "2026-11-26T09:00:00Z",
  asset_name: "jjdr_0.4.0_x64-setup.exe",
  asset_download_url: "https://example.com/jjdr_0.4.0_x64-setup.exe",
  asset_size_bytes: 12_345_678,
};

describe("updatePolicy", () => {
  it("normalizes version prefixes and whitespace", () => {
    expect(normalizeVersion("  v0.4.0  ")).toBe("0.4.0");
    expect(normalizeVersion("V1.2.3")).toBe("1.2.3");
    expect(normalizeVersion(null)).toBe("");
  });

  it("hides popup when no update is available", () => {
    const upToDate: UpdateCheckResult = {
      ...sampleUpdate,
      latest_version: "0.3.0",
      has_update: false,
    };
    expect(shouldShowUpdatePopup(upToDate, null, false)).toBe(false);
    expect(shouldShowUpdatePopup(upToDate, null, true)).toBe(false);
  });

  it("respects skipped version on automatic check but shows on manual check", () => {
    expect(shouldShowUpdatePopup(sampleUpdate, "0.4.0", false)).toBe(false);
    expect(shouldShowUpdatePopup(sampleUpdate, "v0.4.0", false)).toBe(false);
    expect(shouldShowUpdatePopup(sampleUpdate, "0.4.0", true)).toBe(true);
  });

  it("shows popup again when a newer release arrives after a skipped version", () => {
    const newer: UpdateCheckResult = {
      ...sampleUpdate,
      latest_version: "0.5.0",
    };
    expect(shouldShowUpdatePopup(newer, "0.4.0", false)).toBe(true);
  });

  it("formats bytes, dates, and fallback release notes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(formatBytes(null)).toBe("");

    expect(formatReleaseDate("2026-11-26T09:00:00Z")).toBe("2026-11-26");
    expect(formatReleaseDate("not-a-date")).toBe("");

    expect(resolveReleaseNotesMarkdown("", "0.4.0")).toContain("jjdr v0.4.0");
    expect(resolveReleaseNotesMarkdown("  - Fix bug  ", "0.4.0")).toBe("- Fix bug");
  });

  it("builds a valid DEV mock update payload", () => {
    const mock = buildMockUpdateResult("v0.3.0");
    expect(mock.current_version).toBe("0.3.0");
    expect(mock.has_update).toBe(true);
    expect(mock.release_notes).toContain("What's New");
  });
});
