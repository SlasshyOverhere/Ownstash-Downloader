# Slasshy OmniDownloader - Chrome Extension

A Chrome extension that integrates with the Slasshy OmniDownloader desktop app to easily download media from your favorite websites.

## Features

✨ **User-Controlled Sites** - Only works on sites YOU add  
📥 **One-Click Downloads** - Send any URL to your desktop app instantly  
🎯 **Smart Detection** - Automatically detects videos/audio on popular platforms  
🌐 **Wide Compatibility** - Works with all yt-dlp supported sites (Spotify via app directly)  
🎨 **Beautiful UI** - Premium dark theme with modern design  

## Installation

### Method 1: Load Unpacked (Development)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top-right)
3. Click **Load unpacked**
4. Select this `chrome-extension` folder
5. The extension icon will appear in your toolbar

### Method 2: Pack as CRX (Distribution)

1. Go to `chrome://extensions/`
2. Click **Pack extension**
3. Select this folder as "Extension root directory"
4. Click **Pack Extension**
5. Distribute the `.crx` file

## Usage

### Adding a Website

1. Navigate to any website (e.g., YouTube, YouTube Music, Vimeo)
2. Click the Slasshy extension icon in your toolbar
3. Click **"Add This Site"**
4. A floating download button will appear on that site!

### Downloading Media

**Option 1: Floating Button**
- On enabled sites, click the floating "Download" button in the corner

**Option 2: Extension Popup**
- Click the extension icon and click **"Send to App"**

**Option 3: Right-Click Menu**
- Right-click on any page, link, or media
- Select **"Download with Slasshy"**

### Managing Sites

- **Remove a site**: Click the ❌ button next to it in the enabled sites list
- **Clear all sites**: Go to Settings → Clear All Sites

### Settings

- **Show floating button**: Toggle the on-page download button
- **Button position**: Choose corner placement (bottom-right, bottom-left, etc.)
- **Auto-detect media**: Automatically identify downloadable content

## Supported Platforms

The extension works with all yt-dlp supported sites including:

- 🎬 **YouTube** - Videos, Shorts, Playlists
- 🎵 **YouTube Music** - Tracks and Playlists
- 🎧 **Spotify** - Use app directly for better experience
- 🎶 **SoundCloud** - Tracks and Sets
- 📺 **Vimeo** - Videos
- 🐦 **Twitter/X** - Videos and GIFs
- 📸 **Instagram** - Reels and Posts
- 🎭 **TikTok** - Videos
- 📺 **Twitch** - VODs and Clips
- And 1000+ more platforms!

## Technical Details

### Deep Link Protocol

The extension communicates with the desktop app via the `slasshy://` protocol:

```
slasshy://download?url=<encoded_url>
```

### Storage

All settings are stored locally using Chrome's `storage.local` API:
- `slasshy_enabled_sites` - List of enabled website domains
- `slasshy_settings` - User preferences

### Required Permissions

- `storage` - Save enabled sites and settings
- `activeTab` - Access current tab URL
- `tabs` - Tab management
- `<all_urls>` - Show download button on any site

## Troubleshooting

### Extension doesn't show download button
- Make sure you've added the site (click extension → Add This Site)
- Check Settings → "Show floating button" is enabled
- Refresh the page

### "Send to App" doesn't work
1. Make sure Slasshy OmniDownloader desktop app is installed
2. The app needs to be run at least once to register the `slasshy://` protocol
3. Try opening `slasshy://open` manually in your browser

### Button appears in wrong position
- Go to Settings → Button position → Choose your preferred corner

## License

Part of Slasshy OmniDownloader - © 2024 Suman Patgiri
