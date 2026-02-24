# Ownstash Downloader

Ownstash Downloader is a desktop-first media downloader built with Tauri (Rust backend + React frontend).  
It focuses on fast local downloads with built-in engine management for `yt-dlp` and `SpotDL`.

## Download

- Latest Windows installer (stable URL):  
  `https://github.com/SlasshyOverhere/Ownstash-Downloader/releases/latest/download/ownstash-downloader-windows-x64-setup.exe`
- Latest release page:  
  `https://github.com/SlasshyOverhere/Ownstash-Downloader/releases/latest`
- All releases:  
  `https://github.com/SlasshyOverhere/Ownstash-Downloader/releases`

## What It Does

- Downloads media from 1000+ supported platforms via `yt-dlp`.
- Downloads Spotify content via `SpotDL`.
- Supports local-only workflow for core downloading (no mandatory sign-in for basic use).
- Includes queue/history/download management UI.
- Includes system tray integration, taskbar progress, and native notifications.
- Supports in-app updater plus engine update checks (current vs latest versions).

## Tech Stack

- Tauri 2 + Rust
- React + TypeScript + Vite
- TailwindCSS + Framer Motion
- `yt-dlp`, `SpotDL`, `FFmpeg`, `FFprobe`

## Local Development

### Prerequisites

- Node.js 20+
- Rust stable toolchain
- Windows PowerShell (for binary bootstrap script)

### Run

```bash
git clone https://github.com/SlasshyOverhere/Ownstash-Downloader.git
cd Ownstash-Downloader
npm install
npm run download-binaries
npm run tauri dev
```

`npm run download-binaries` downloads and places required runtime binaries into `src-tauri/binaries`.

## Build Installer

```bash
npm run build-installer
```

This runs binary bootstrap + Tauri build in one command.

## Release Automation

This repo includes a tag-driven GitHub Actions release pipeline (`.github/workflows/release.yml`).

- Trigger: push a tag in the format `vX.Y.Z` (or prerelease form like `vX.Y.Z-beta.1`).
- Pipeline behavior:
1. Syncs app version across `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
2. Builds signed Windows artifacts.
3. Publishes GitHub Release assets, including updater metadata (`latest.json`).
4. Marks stable tags as latest.

### Required GitHub Secrets (for signed updater builds)

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

One-time key generation example:

```bash
npm run tauri signer generate -- -w ~/.tauri/ownstash.key
```

## Browser Extension (Optional)

The repo includes an optional browser extension in `chrome-extension`.

1. Open `chrome://extensions/`
2. Enable Developer Mode
3. Load unpacked extension from `chrome-extension`

## Repo Layout

- `src`: React frontend
- `src-tauri`: Rust backend, Tauri config, updater/release integration
- `chrome-extension`: optional browser extension
- `.github/workflows/release.yml`: automated tag-based release pipeline

## Legal

Use this tool only for content you have rights to download. You are responsible for complying with platform terms and local laws.

## Credits

- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [SpotDL](https://github.com/spotDL/spotify-downloader)
- [Tauri](https://tauri.app/)
