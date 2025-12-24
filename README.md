# Slasshy OmniDownloader 🚀

**The Ultimate Cross-Platform Media Hub**

Slasshy OmniDownloader is a powerful, modern, and beautiful application designed to be your one-stop solution for downloading, organizing, and consuming media. Built with the latest web technologies and Rust, it delivers native performance with a stunning user interface.

![Slasshy OmniDownloader](https://img.shields.io/badge/Version-1.0.0-blue?style=for-the-badge)
![License](https://img.shields.io/badge/License-MIT-green?style=for-the-badge)
![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS%20%7C%20Linux-orange?style=for-the-badge)

---

## ⚡ Tech Stack

Built on the cutting edge of modern app development:

| Technology | Purpose |
|------------|---------|
| **[Tauri 2](https://v2.tauri.app/)** | Core runtime (Rust + Webview) |
| **React 19 + TypeScript** | Frontend framework |
| **TailwindCSS + shadcn/ui** | Styling & UI components |
| **Firebase** | Cloud sync & authentication |
| **Framer Motion + Three.js** | Immersive 3D effects & animations |

---

## ✨ Features

### 🎬 Universal Downloader
- Support for **1000+ platforms** including YouTube, Twitch, Instagram, TikTok, and more
- Powered by yt-dlp for maximum compatibility
- Spotify playlist & track downloads via SpotDL integration

### ☁️ Cloud Sync (NEW!)
- **Firebase Authentication** - Sign in with Google
- **Cross-device sync** - Access your download history and settings from anywhere
- **Automatic backup** - Never lose your data

### 📺 Smart Library
- Automatic organization of downloaded movies and TV shows
- Metadata fetching and thumbnail generation
- Quick search and filter capabilities

### 🎨 Immersive UI
- Rich 3D animated interface with glassmorphism
- Dynamic visual effects and smooth animations
- Dark mode optimized design

### 📊 Real-time Tracking
- Detailed progress bars with speed metrics
- Complete download history
- Queue management

### 🎵 Media Tools
- Audio extraction from videos
- Format conversion support
- Quality selection (up to 8K)

### 🔌 Browser Integration
- Chrome extension for one-click downloads
- Direct integration with YouTube and other platforms
- Context menu support

---

## 🛠️ Development Setup

### Prerequisites

- **Node.js**: v18 or higher
- **Rust**: Latest stable release ([Install Rust](https://www.rust-lang.org/tools/install))
- **Visual Studio C++ Build Tools** (Windows only)
- **yt-dlp**: Must be installed and available in your system PATH
- **FFmpeg**: Required for media processing

### Getting Started

1. **Clone the repository**
   ```bash
   git clone https://github.com/SlasshyOverhere/slasshy-omnidownloader.git
   cd slasshy-omnidownloader
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env
   # Edit .env with your Firebase credentials
   ```

4. **Download required binaries**
   ```bash
   # Windows (PowerShell)
   .\src-tauri\download-binaries.ps1
   ```

5. **Run Development Environment**
   ```bash
   npm run tauri dev
   ```

6. **Build for Production**
   ```bash
   npm run tauri build
   ```

---

## 🔧 Configuration

### Firebase Setup (Optional - for Cloud Sync)

To enable cloud sync features, you'll need to set up a Firebase project:

1. Create a new project at [Firebase Console](https://console.firebase.google.com/)
2. Enable Authentication (Google Sign-In)
3. Create a Firestore database
4. Copy your config to `.env`

See the full setup guide in the documentation.

---

## 📦 Chrome Extension

The included Chrome extension allows you to download media directly from supported websites:

1. Navigate to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `chrome-extension` folder

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).

---

## 🙏 Acknowledgments

- [yt-dlp](https://github.com/yt-dlp/yt-dlp) - The backbone of our download engine
- [SpotDL](https://github.com/spotDL/spotify-downloader) - Spotify integration
- [Tauri](https://tauri.app/) - For making cross-platform apps awesome
- [shadcn/ui](https://ui.shadcn.com/) - Beautiful UI components

---

<p align="center">
  Made with ❤️ by <a href="https://github.com/SlasshyOverhere">Slasshy</a>
</p>
