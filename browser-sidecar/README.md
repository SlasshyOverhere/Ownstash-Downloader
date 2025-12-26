# 🛡️ Slasshy Secure Browser Engine

An Electron-based sidecar application providing a secure browser with **Custom Incognito Mode** and **Secure Download Pipeline** for the Slasshy OmniDownloader.

## 🎯 Features

### 1. Custom Incognito Mode
Unlike standard incognito mode, our custom implementation:
- **Preserves Extension Data**: Extensions like NordVPN, uBlock Origin stay logged in
- **Clears Web Content**: Website cookies, localStorage, and cache are wiped on exit
- Uses a persistent partition (`persist:extensions`) for extension storage

### 2. Secure Download Pipeline
All downloads are intercepted and streamed via `stdout`:
- Downloads are **NOT saved to disk** by the browser
- File content is **base64 encoded** and sent as JSON chunks
- Parent process (Tauri app) handles encryption and storage

### 3. Chrome Extension Support
Full support for Chrome extensions:
- Load extensions from the `extensions/` directory
- Extensions maintain their state across sessions
- Support for manifest v2 and v3 extensions

## 📁 Project Structure

```
browser-sidecar/
├── main.js           # Main Electron process
├── preload.js        # Secure context bridge
├── package.json      # Project configuration
├── assets/           # Icons and static assets
│   └── icon.ico      # Windows application icon
├── extensions/       # Chrome extensions directory
│   └── README.md     # Extension installation guide
├── renderer/         # Renderer process files
│   └── index.html    # Landing page
└── dist/             # Build output (generated)
```

## 🚀 Quick Start

### Development
```bash
# Install dependencies
npm install

# Run in development mode
npm start
```

### Build for Production
```bash
# Build Windows executable (unpacked)
npm run build-win

# Build Windows portable executable
npm run build-win-portable
```

## 📡 Communication Protocol

### Parent → Browser (stdin)
Send JSON commands to control the browser:

```json
{"type": "navigate", "url": "https://example.com"}
{"type": "clear-data"}
{"type": "quit"}
{"type": "get-cookies"}
```

### Browser → Parent (stdout)
Receive JSON events:

```json
// Download start
{"type": "download-start", "filename": "file.zip", "mime": "application/zip", "size": 1024}

// Data chunk
{"type": "chunk", "data": "BASE64_ENCODED_STRING", "bytesReceived": 512, "totalBytes": 1024, "progress": 50}

// Download complete
{"type": "download-end", "filename": "file.zip", "totalBytes": 1024, "success": true}

// Logs
{"type": "log", "level": "info", "message": "...", "data": {...}}

// Errors
{"type": "error", "message": "...", "filename": "..."}
```

## 🔒 Security Model

1. **Context Isolation**: `contextIsolation: true` prevents renderer access to Node.js
2. **Disabled Node Integration**: `nodeIntegration: false` for renderer process
3. **Secure Preload**: Limited API exposed via `contextBridge`
4. **Web Security**: `webSecurity: true` enforces same-origin policy

## 🧩 Adding Extensions

1. Copy extension folder to `extensions/`
2. Ensure `manifest.json` exists in the extension root
3. Restart the browser

Example:
```
extensions/
├── nordvpn/
│   ├── manifest.json
│   └── ...
└── ublock-origin/
    ├── manifest.json
    └── ...
```

## 🔧 Configuration

Edit the `CONFIG` object in `main.js`:

```javascript
const CONFIG = {
  EXTENSION_PARTITION: 'persist:extensions',
  DEFAULT_URL: 'https://www.google.com',
  WINDOW_WIDTH: 1400,
  WINDOW_HEIGHT: 900,
  // ...
};
```

## 📦 Build Output

After running `npm run build-win`, find the executable in:
- `dist/win-unpacked/Slasshy Secure Browser.exe`

For portable build (`npm run build-win-portable`):
- `dist/Slasshy Secure Browser.exe`

## 🔗 Integration with Tauri

The parent Tauri application should:
1. Spawn this executable as a child process
2. Write JSON commands to its `stdin`
3. Read JSON events from its `stdout`
4. Handle download chunks and pipe to Vault encryption

Example Rust code (conceptual):
```rust
use std::process::{Command, Stdio};
use std::io::{BufReader, BufRead, Write};

let mut child = Command::new("browser-sidecar.exe")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .spawn()?;

// Navigate
writeln!(child.stdin.as_mut().unwrap(), r#"{{"type":"navigate","url":"https://example.com"}}"#)?;

// Read events
let reader = BufReader::new(child.stdout.take().unwrap());
for line in reader.lines() {
    let event: serde_json::Value = serde_json::from_str(&line?)?;
    match event["type"].as_str() {
        Some("chunk") => handle_download_chunk(&event),
        Some("log") => println!("Browser: {}", event["message"]),
        _ => {}
    }
}
```

## 📄 License

MIT License - Part of Slasshy OmniDownloader
