# Slasshy Secure Browser - Assets

This directory contains static assets for the Secure Browser.

## Required Files

- `icon.ico` - Windows icon (256x256 recommended)
- `icon.png` - PNG icon for other purposes

## Generating Icons

If you don't have an icon, you can use a placeholder or generate one:

1. Use any image editor to create a 256x256 PNG
2. Convert to ICO using an online converter or ImageMagick:
   ```bash
   magick convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico
   ```
