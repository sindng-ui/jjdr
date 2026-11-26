#!/usr/bin/env node
/**
 * Local Mock GitHub Releases Server for E2E testing of jjdr auto-updater.
 *
 * Usage:
 *   npm run test:update-mock
 *   node scripts/mock-update-server.mjs --port=18420 --version=9.9.9 --size-mb=3
 *   node scripts/mock-update-server.mjs --version=0.3.0              # Test "already up-to-date"
 *   node scripts/mock-update-server.mjs --fail-download              # Test download failure -> fallback UI
 *   node scripts/mock-update-server.mjs --status=404                 # Test API error handling
 *
 * Then launch jjdr in another terminal:
 *   PowerShell:
 *     $env:JJDR_UPDATE_FEED_URL="http://127.0.0.1:18420/latest"
 *     $env:JJDR_UPDATE_DRY_RUN="1"
 *     npm run tauri:dev
 */

import http from "node:http";

const args = new Map();
for (const raw of process.argv.slice(2)) {
  if (raw.startsWith("--")) {
    const [k, v] = raw.slice(2).split("=");
    args.set(k, v ?? "true");
  }
}

const port = Number(args.get("port") ?? 18420);
const version = (args.get("version") ?? "9.9.9").replace(/^v/i, "");
const sizeMb = Math.max(0.2, Number(args.get("size-mb") ?? 3));
const failDownload = args.get("fail-download") === "true";
const apiStatus = Number(args.get("status") ?? 200);
const assetName = `jjdr_${version}_x64-setup.exe`;
const totalBytes = Math.round(sizeMb * 1024 * 1024);

const releasePayload = {
  tag_name: `v${version}`,
  name: `jjdr v${version} (Local Mock Release)`,
  published_at: new Date().toISOString(),
  html_url: "https://github.com/sindng-ui/jjdr/releases/latest",
  draft: false,
  prerelease: false,
  body: [
    `## What's New in v${version}`,
    "",
    "- **자동 업데이트 팝업**: 앱 실행 시 GitHub Releases 최신 버전을 비동기로 확인합니다.",
    "- **인앱 인스톨러 다운로드**: 진행률 바와 함께 다운로드 후 바로 설치를 시작합니다.",
    "- **AI 세션 무손실 보호**: 업데이트로 앱이 종료되어도 `herdr-core`의 실행 중인 세션은 유지됩니다.",
    "- **이 버전 건너뛰기 (Skip)**: 원치 않는 버전은 건너뛰고 다음 버전에서 다시 알림을 받을 수 있습니다.",
    "",
    "### 테스트 체크리스트",
    "- [x] Markdown 리스트 / 강조 / 코드 렌더링 확인",
    "- [x] `Skip` 클릭 후 앱 재실행 시 팝업 미표시 확인",
    "- [x] `업데이트` 클릭 시 진행률 0% → 100% 스트리밍 확인",
  ].join("\n"),
  assets: [
    {
      name: assetName,
      browser_download_url: `http://127.0.0.1:${port}/assets/${assetName}`,
      size: totalBytes,
    },
  ],
};

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  console.log(`[mock-update] ${req.method} ${url}`);

  if (url === "/latest" || url === "/releases/latest") {
    if (apiStatus !== 200) {
      res.writeHead(apiStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: `Simulated HTTP ${apiStatus}` }));
      return;
    }
    const body = JSON.stringify(releasePayload, null, 2);
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
    return;
  }

  if (url.startsWith("/assets/")) {
    if (failDownload) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end("Simulated download failure");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Length": totalBytes,
    });

    // Stream in ~25 slices over ~1.8s so the progress bar animates smoothly
    const slices = 25;
    const chunkSize = Math.ceil(totalBytes / slices);
    let sent = 0;

    const timer = setInterval(() => {
      if (res.writableEnded || res.destroyed) {
        clearInterval(timer);
        return;
      }
      const remaining = totalBytes - sent;
      if (remaining <= 0) {
        clearInterval(timer);
        res.end();
        console.log(`[mock-update] Completed streaming ${totalBytes} bytes`);
        return;
      }
      const size = Math.min(chunkSize, remaining);
      const buf = Buffer.alloc(size, 0x4a);
      res.write(buf);
      sent += size;
    }, 70);

    req.on("close", () => clearInterval(timer));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not Found. Try GET /latest");
});

server.listen(port, "127.0.0.1", () => {
  console.log("==========================================================");
  console.log(` jjdr Mock Update Server listening on http://127.0.0.1:${port}`);
  console.log(` Feed URL     : http://127.0.0.1:${port}/latest`);
  console.log(` Mock Version : v${version} (API status: ${apiStatus})`);
  console.log(
    ` Asset Stream : ${assetName} (${sizeMb} MB, fail=${failDownload})`
  );
  console.log("==========================================================");
  console.log("PowerShell에서 앱 실행 예시:");
  console.log(
    `  $env:JJDR_UPDATE_FEED_URL="http://127.0.0.1:${port}/latest"; $env:JJDR_UPDATE_DRY_RUN="1"; npm run tauri:dev`
  );
});
