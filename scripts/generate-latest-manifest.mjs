#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

/**
 * Recursively collect Windows installer files (.exe / .msi) under a Tauri bundle directory.
 */
export function collectInstallerAssets(bundleDir, repo, tagName) {
  if (!bundleDir || !fs.existsSync(bundleDir)) return [];
  const results = [];

  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const lower = entry.name.toLowerCase();
      if (
        (lower.endsWith(".exe") || lower.endsWith(".msi")) &&
        !lower.endsWith(".sig") &&
        !lower.endsWith(".sha256")
      ) {
        const stat = fs.statSync(full);
        results.push({
          name: entry.name,
          browser_download_url: `https://github.com/${repo}/releases/download/${encodeURIComponent(
            tagName
          )}/${encodeURIComponent(entry.name)}`,
          size: stat.size,
        });
      }
    }
  };

  walk(bundleDir);
  results.sort((a, b) => {
    const aExe = a.name.toLowerCase().endsWith(".exe") ? 0 : 1;
    const bExe = b.name.toLowerCase().endsWith(".exe") ? 0 : 1;
    if (aExe !== bExe) return aExe - bExe;
    return a.name.localeCompare(b.name);
  });
  return results;
}

/**
 * Build a GitHubReleasePayload-compatible static manifest (`latest.json`) served from
 * GitHub Release Assets CDN (`releases/latest/download/latest.json`) with zero API rate limits.
 */
export function buildLatestManifest({
  version,
  repo,
  releaseNotes = "",
  assets = [],
  publishedAt = new Date().toISOString(),
}) {
  const cleanVer = String(version || "")
    .trim()
    .replace(/^v/i, "");
  const tagName = `v${cleanVer}`;
  return {
    tag_name: tagName,
    name: `jjdr ${tagName}`,
    body: String(releaseNotes || "").trim(),
    html_url: `https://github.com/${repo}/releases/tag/${tagName}`,
    published_at: publishedAt,
    draft: false,
    prerelease: false,
    assets,
  };
}

function parseCliArgs(argv) {
  const out = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq === -1) {
      out[arg.slice(2)] = "true";
    } else {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    }
  }
  return out;
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(
    `/${path.basename(process.argv[1] || "").replace(/\\/g, "/")}`
  )
) {
  const args = parseCliArgs(process.argv.slice(2));
  const version = args.version || "";
  const repo = args.repo || "sindng-ui/jjdr";
  const bundleDir = args["bundle-dir"] || "src-tauri/target/release/bundle";
  const outPath = args.out || "latest.json";

  if (!version) {
    console.error("Missing --version=<semver>");
    process.exit(1);
  }

  const tagName = `v${version.replace(/^v/i, "")}`;
  let notes = process.env.RELEASE_NOTES_BODY || "";
  if (!notes && args["notes-file"] && fs.existsSync(args["notes-file"])) {
    notes = fs.readFileSync(args["notes-file"], "utf8");
  }

  const assets = collectInstallerAssets(bundleDir, repo, tagName);
  const manifest = buildLatestManifest({
    version,
    repo,
    releaseNotes: notes,
    assets,
  });

  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(
    `Generated ${outPath} for ${manifest.tag_name} with ${assets.length} installer asset(s).`
  );
}
