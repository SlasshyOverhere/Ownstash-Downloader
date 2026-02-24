# Ownstash Downloader

Ownstash Downloader is a desktop media downloader built with Tauri, Rust, React, and TypeScript.

## Features
- Download from 1000+ platforms through `yt-dlp`.
- Spotify/SpotDL support.
- Native desktop app with system tray support.
- Built-in player and download manager.
- Auto-update support via GitHub Releases.

## Stack
- Tauri 2 + Rust
- React + TypeScript + Vite
- TailwindCSS + Framer Motion
- yt-dlp, SpotDL, FFmpeg

## Getting Started
1. Clone the repo.
2. Install dependencies:
```bash
npm install
```
3. Copy env file:
```bash
cp .env.example .env
```
4. Download required binaries:
```powershell
.\src-tauri\download-binaries.ps1
```
5. Run in development:
```bash
npm run tauri dev
```

## Build
```bash
npm run build-installer
```

## Browser Extension
1. Open `chrome://extensions/`
2. Enable Developer mode
3. Load unpacked from `/chrome-extension`

## Acknowledgments
- [yt-dlp](https://github.com/yt-dlp/yt-dlp)
- [SpotDL](https://github.com/spotDL/spotify-downloader)
- [Tauri](https://tauri.app/)
