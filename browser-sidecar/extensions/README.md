# Slasshy Secure Browser - Extensions Directory

This directory is for Chrome extensions that will be loaded into the Secure Browser.

## How to Add Extensions

1. Download the extension's unpacked source or export it from Chrome
2. Create a folder for the extension (e.g., `nordvpn`, `ublock-origin`)
3. Place the extension files inside, including the `manifest.json`

## Directory Structure Example

```
extensions/
├── nordvpn/
│   ├── manifest.json
│   ├── background.js
│   └── ...
├── ublock-origin/
│   ├── manifest.json
│   └── ...
└── README.md
```

## Notes

- Extensions in this directory will persist across sessions (Custom Incognito)
- Extension cookies and storage are NOT cleared on exit
- Only website cookies and data are cleared
