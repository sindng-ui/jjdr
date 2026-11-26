#!/usr/bin/env node
/**
 * Generate structured Markdown "What's New" release notes from Git history
 * (and optional CHANGELOG.md section / workflow_dispatch custom notes).
 *
 * Used by `.github/workflows/release.yml` to populate GitHub Release body so
 * both GitHub Releases and jjdr's in-app UpdateModal display real change notes.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RECORD_SEP = "\x1e";
const FIELD_SEP = "\x1f";
const TRAILER_RE =
  /^(co-authored-by|signed-off-by|reviewed-by|acked-by|tested-by|change-id):/i;
const VERSION_SCOPE_RE = /^v?\d+\.\d+(?:\.\d+)?(?:-[0-9a-z.-]+)?$/i;

export function normalizeVersion(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^[vV]/, "")
    .trim();
}

export function extractChangelogSection(changelogText, version) {
  if (!changelogText || !version) return "";
  const norm = normalizeVersion(version);
  if (!norm) return "";
  const escaped = norm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(
    `^##\\s+\\[?v?${escaped}\\]?(?:\\s|$|\\().*$`,
    "im"
  );
  const match = headingRe.exec(changelogText);
  if (!match) return "";

  const startIdx = match.index + match[0].length;
  const rest = changelogText.slice(startIdx);
  const nextHeadingIdx = rest.search(/^##\s+/m);
  const section =
    nextHeadingIdx === -1 ? rest : rest.slice(0, nextHeadingIdx);
  return section.trim();
}

export function parseGitLogOutput(rawLog) {
  if (!rawLog || !rawLog.trim()) return [];
  const commits = [];
  for (const record of rawLog.split(RECORD_SEP)) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const [hash = "", shortHash = "", subject = "", body = ""] =
      trimmed.split(FIELD_SEP);
    if (!subject.trim()) continue;
    commits.push({
      hash: hash.trim(),
      shortHash: shortHash.trim(),
      subject: subject.trim(),
      body: body.trim(),
    });
  }
  return commits;
}

export function extractBodyBullets(body) {
  if (!body) return [];
  const bullets = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || TRAILER_RE.test(line)) continue;
    const bulletMatch = /^[-*•]\s+(.+)$/.exec(line);
    if (bulletMatch) {
      bullets.push(bulletMatch[1].trim());
    }
  }
  return bullets;
}

export function classifyCommit(commit) {
  const subject = commit.subject.trim();
  const ccMatch =
    /^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/.exec(subject);

  if (ccMatch) {
    const type = ccMatch[1].toLowerCase();
    const rawScope = (ccMatch[2] ?? "").trim();
    const breaking = Boolean(ccMatch[3]);
    const desc = ccMatch[4].trim();
    const scope =
      rawScope && !VERSION_SCOPE_RE.test(rawScope) ? rawScope : "";

    let category = "other";
    if (type === "feat") category = "feat";
    else if (type === "fix") category = "fix";
    else if (type === "perf" || type === "refactor" || type === "style") {
      category = "improve";
    }

    return {
      category,
      scope,
      breaking,
      description: desc,
      bullets: extractBodyBullets(commit.body),
      shortHash: commit.shortHash,
      hash: commit.hash,
    };
  }

  // Handle legacy commits like "v0.2.0: ..." or plain descriptive subjects
  const plainDesc = subject.replace(/^v?\d+\.\d+\.\d+\s*:\s*/i, "").trim();
  return {
    category: "general",
    scope: "",
    breaking: false,
    description: plainDesc || subject,
    bullets: extractBodyBullets(commit.body),
    shortHash: commit.shortHash,
    hash: commit.hash,
  };
}

function formatCommitEntry(entry, repo) {
  const prefixParts = [];
  if (entry.breaking) prefixParts.push("**[BREAKING]**");
  if (entry.scope) prefixParts.push(`**${entry.scope}**:`);
  const prefix = prefixParts.length > 0 ? `${prefixParts.join(" ")} ` : "";

  const commitRef =
    entry.shortHash && repo
      ? ` ([${entry.shortHash}](https://github.com/${repo}/commit/${entry.hash || entry.shortHash}))`
      : entry.shortHash
      ? ` (\`${entry.shortHash}\`)`
      : "";

  const lines = [`- ${prefix}${entry.description}${commitRef}`];
  for (const sub of entry.bullets.slice(0, 6)) {
    lines.push(`  - ${sub}`);
  }
  return lines.join("\n");
}

export function buildReleaseNotesMarkdown({
  version,
  previousTag = "",
  commits = [],
  repo = "sindng-ui/jjdr",
  changelogSection = "",
  customNotes = "",
}) {
  const normVersion = normalizeVersion(version) || "0.0.0";
  const currentTag = `v${normVersion}`;
  const blocks = [`## What's New in ${currentTag}`];

  const cleanCustom = customNotes.trim();
  if (cleanCustom) {
    blocks.push(cleanCustom);
  }

  const cleanChangelog = changelogSection.trim();
  if (cleanChangelog) {
    blocks.push(cleanChangelog);
  }

  const groups = {
    feat: [],
    fix: [],
    improve: [],
    general: [],
    other: [],
  };

  for (const commit of commits) {
    const entry = classifyCommit(commit);
    groups[entry.category].push(entry);
  }

  const sectionDefs = [
    ["feat", "### ✨ 새로운 기능"],
    ["fix", "### 🐛 버그 수정"],
    ["improve", "### ⚡ 성능 & 개선"],
    ["general", "### 📌 주요 변경사항"],
    ["other", "### 📝 기타 변경사항"],
  ];

  let addedCommitSection = false;
  for (const [key, title] of sectionDefs) {
    if (groups[key].length === 0) continue;
    addedCommitSection = true;
    const items = groups[key].map((e) => formatCommitEntry(e, repo)).join("\n");
    blocks.push(`${title}\n${items}`);
  }

  if (!cleanCustom && !cleanChangelog && !addedCommitSection) {
    blocks.push("- 최신 안정성 및 성능 개선 사항이 반영되었습니다.");
  }

  if (previousTag && repo) {
    blocks.push(
      `**Full Changelog**: [${previousTag}...${currentTag}](https://github.com/${repo}/compare/${previousTag}...${currentTag})`
    );
  }

  return blocks.join("\n\n").trim() + "\n";
}

function runGit(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

export function findPreviousReleaseTag(currentVersion) {
  const currentTag = `v${normalizeVersion(currentVersion)}`;
  const rawTags = runGit(["tag", "--list", "v*", "--sort=-v:refname"]);
  if (!rawTags) return "";
  const tags = rawTags
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  return tags.find((t) => t !== currentTag) ?? "";
}

export function collectCommitsSinceTag(previousTag) {
  const format = `--format=%H${FIELD_SEP}%h${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;
  const range = previousTag ? `${previousTag}..HEAD` : "HEAD";
  const raw = runGit(["log", range, "--no-merges", format]);
  const commits = parseGitLogOutput(raw);
  if (commits.length > 0) return commits;

  // Fallback when tag already points to HEAD (e.g. manual re-run)
  const fallbackRaw = runGit(["log", "-n", "1", "--no-merges", format]);
  return parseGitLogOutput(fallbackRaw);
}

function writeGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT environment variable is not set.");
  }
  const delimiter = `JJDR_NOTES_EOF_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
  const payload = `${name}<<${delimiter}\n${value}\n${delimiter}\n`;
  fs.appendFileSync(outputPath, payload, "utf8");
}

function parseCliArgs(argv) {
  const map = new Map();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eqIdx = raw.indexOf("=");
    if (eqIdx === -1) {
      map.set(raw.slice(2), "true");
    } else {
      map.set(raw.slice(2, eqIdx), raw.slice(eqIdx + 1));
    }
  }
  return map;
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const pkgPath = path.resolve(process.cwd(), "package.json");
  const pkgVersion = fs.existsSync(pkgPath)
    ? JSON.parse(fs.readFileSync(pkgPath, "utf8")).version
    : "0.0.0";

  const version = args.get("version") || pkgVersion;
  const repo =
    args.get("repo") || process.env.GITHUB_REPOSITORY || "sindng-ui/jjdr";
  const customNotes =
    args.get("custom-notes") || process.env.CUSTOM_NOTES || "";

  const changelogPath = path.resolve(process.cwd(), "CHANGELOG.md");
  const changelogSection = fs.existsSync(changelogPath)
    ? extractChangelogSection(fs.readFileSync(changelogPath, "utf8"), version)
    : "";

  const previousTag = args.get("from-tag") ?? findPreviousReleaseTag(version);
  const commits = collectCommitsSinceTag(previousTag);

  const markdown = buildReleaseNotesMarkdown({
    version,
    previousTag,
    commits,
    repo,
    changelogSection,
    customNotes,
  });

  const outFile = args.get("output");
  if (outFile) {
    fs.writeFileSync(path.resolve(process.cwd(), outFile), markdown, "utf8");
  }

  const ghOutName = args.get("github-output");
  if (ghOutName) {
    writeGithubOutput(ghOutName, markdown);
  }

  process.stdout.write(markdown);
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectExecution) {
  main();
}
