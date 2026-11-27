import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLatestManifest,
  collectInstallerAssets,
} from "./generate-latest-manifest.mjs";

describe("generate-latest-manifest", () => {
  it("collects .exe and .msi installer assets recursively and ignores signatures", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jjdr-manifest-test-"));
    try {
      const nsisDir = path.join(tmp, "nsis");
      const msiDir = path.join(tmp, "msi");
      fs.mkdirSync(nsisDir, { recursive: true });
      fs.mkdirSync(msiDir, { recursive: true });

      fs.writeFileSync(path.join(nsisDir, "jjdr_0.4.8_x64-setup.exe"), "exe-bytes");
      fs.writeFileSync(path.join(nsisDir, "jjdr_0.4.8_x64-setup.exe.sig"), "sig");
      fs.writeFileSync(path.join(msiDir, "jjdr_0.4.8_x64_en-US.msi"), "msi-bytes-123");

      const assets = collectInstallerAssets(tmp, "sindng-ui/jjdr", "v0.4.8");
      expect(assets).toHaveLength(2);
      expect(assets[0].name).toBe("jjdr_0.4.8_x64-setup.exe");
      expect(assets[0].browser_download_url).toBe(
        "https://github.com/sindng-ui/jjdr/releases/download/v0.4.8/jjdr_0.4.8_x64-setup.exe"
      );
      expect(assets[0].size).toBe(9);
      expect(assets[1].name).toBe("jjdr_0.4.8_x64_en-US.msi");
      expect(assets[1].size).toBe(13);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("builds GitHubReleasePayload-compatible latest.json manifest", () => {
    const manifest = buildLatestManifest({
      version: "0.4.8",
      repo: "sindng-ui/jjdr",
      releaseNotes: "## What's New\n- Unlimited CDN update feed",
      assets: [
        {
          name: "jjdr_0.4.8_x64-setup.exe",
          browser_download_url:
            "https://github.com/sindng-ui/jjdr/releases/download/v0.4.8/jjdr_0.4.8_x64-setup.exe",
          size: 1024,
        },
      ],
      publishedAt: "2026-11-27T03:00:00Z",
    });

    expect(manifest.tag_name).toBe("v0.4.8");
    expect(manifest.name).toBe("jjdr v0.4.8");
    expect(manifest.html_url).toBe(
      "https://github.com/sindng-ui/jjdr/releases/tag/v0.4.8"
    );
    expect(manifest.draft).toBe(false);
    expect(manifest.prerelease).toBe(false);
    expect(manifest.assets).toHaveLength(1);
  });
});
