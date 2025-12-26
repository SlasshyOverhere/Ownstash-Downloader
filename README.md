# 🚀 Slasshy OmniDownloader

**"Download Everything. Protect Anything."**

Slasshy OmniDownloader is a powerful, modern, and beautiful media powerhouse designed to be your one-stop solution for downloading, organizing, and consuming media. Built with **Tauri 2**, **Rust**, and **React 19**, it delivers native performance with a stunning, premium user interface.

![Slasshy OmniDownloader](https://img.shields.io/badge/Version-2.0.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-orange?style=for-the-badge)

---

## ✨ Killer Features

### 🎬 Universal Downloader
- **1000+ Platforms Supported**: YouTube, Twitch, Instagram, TikTok, Twitter/X, Reddit, and more.
- **8K Video Support**: Download in highest available resolutions.
- **Playlist & Channel Downloads**: Grab entire collections with a single click.
- **SponsorBlock Integration**: Automatically skip ads, sponsors, and intros in YouTube videos.
- **Multi-Connection Speed**: Accelerated downloads via `aria2c` integration.

### 🔒 The Vault (Military-Grade Security)
- **AES-256-GCM Encryption**: Your sensitive media is protected by the same standards used by governments.
- **Zero-Knowledge Cloud Sync**: Encrypted files and metadata are synced to your Google Drive (`appDataFolder`). Google sees only random blobs.
- **Forensic-Proof**: No filenames, metadata, or file types are stored in plaintext. Even the local index is encrypted.
- **On-the-Fly Decryption**: Play your encrypted files directly within the app without ever writing plaintext to disk.

### 🎵 Spotify Integration
- **SpotDL Integration**: Download entire Spotify playlists and tracks as MP3/FLAC.
- **Automatic Metadata**: High-quality album art, lyrics, and ID3 tags embedded automatically.

### 🌐 Secure Vault Browser (Sidecar)
- **Built-in Secure Engine**: A standalone Electron-based "Secure Browser" for the Vault.
- **Custom Incognito**: Browse and sniff media links with absolute privacy.
- **Direct Stream to Vault**: Download media directly into the encrypted vault from the browser.

### 📺 Integrated Media Tools
- **Native Media Player**: A beautiful, fluid player built right into the app.
- **Format Converter**: Extract audio or convert files to MP4, MKV, MP3, FLAC, and more.
- **System Tray Agent**: Keep downloads running in the background with a minimal footprint.

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|------------|
| **Core Runtime** | [Tauri 2](https://v2.tauri.app/) (Rust + Webview) |
| **Frontend** | React 19 + TypeScript |
| **Styling** | TailwindCSS + shadcn/ui |
| **Animations** | Framer Motion + Three.js |
| **Browser Engine** | Electron (Secure Sidecar) |
| **Security** | AES-256-GCM + Argon2id |
| **Services** | Firebase (Auth/Sync) + Google Drive API |
| **Engines** | yt-dlp + aria2c + SpotDL + FFmpeg |

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18+ 
- **Rust**: Latest stable release ([Install Rust](https://www.rust-lang.org/tools/install))
- **FFmpeg**: Required for media merging and conversion
- **yt-dlp**: Must be in your system PATH

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/SlasshyOverhere/slasshy-omnidownloader.git
   cd slasshy-omnidownloader
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   ```bash
   cp .env.example .env
   # Add your Firebase and Google OAuth credentials
   ```

4. **Download Sidecar Binaries**
   ```powershell
   # Windows
   .\src-tauri\download-binaries.ps1
   ```

5. **Run Development Mode**
   ```bash
   npm run tauri dev
   ```

---

## 🔧 Configuration

### Firebase & Google Drive
To enable Cloud Sync and the Vault:
1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Google Sign-In**.
3. Create a **Google Cloud Project** and enable the **Google Drive API**.
4. Configure your `.env` with the Client IDs and API keys.

---

## 📦 Browser Extension

The Slasshy Chrome Extension provides one-click integration:
1. Open `chrome://extensions/`
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `/chrome-extension` folder.

---

## 🌐 Web Landing Page

The project includes a stunning, high-conversion landing page built with **Next.js** and **Three.js**:
- Located in the `/frontend-landing-page` directory.
- Features immersive 3D effects and detailed documentation of the app's capabilities.
- Integrated with the deep link protocol for a seamless "Download to App" experience.

---

## 🙏 Acknowledgments

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - The ultimate download engine.
- [Tauri](https://tauri.app/) - For the incredible lightweight framework.
- [SpotDL](https://github.com/spotDL/spotify-downloader) - Spotify integration magic.
- [aria2](https://github.com/aria2/aria2) - Blazing fast download segments.

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/SlasshyOverhere">Slasshy</a>
</p>
