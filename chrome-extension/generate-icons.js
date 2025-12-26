/**
 * Icon Generator for Chrome Extension
 * Creates different sized icons from the source 128x128 icon
 * 
 * Usage: node generate-icons.js
 * Requires: sharp package (npm install sharp)
 */

import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SOURCE_ICON = path.join(__dirname, 'icons', 'icon128.png');
const OUTPUT_DIR = path.join(__dirname, 'icons');

const SIZES = [16, 32, 48, 128];

async function generateIcons() {
    console.log('Generating Chrome extension icons...\n');

    // Check if source exists
    if (!fs.existsSync(SOURCE_ICON)) {
        console.error('Error: Source icon not found at', SOURCE_ICON);
        console.log('Please place a 128x128 PNG icon at icons/icon128.png');
        return;
    }

    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    }

    for (const size of SIZES) {
        const outputPath = path.join(OUTPUT_DIR, `icon${size}.png`);

        try {
            await sharp(SOURCE_ICON)
                .resize(size, size, {
                    kernel: sharp.kernel.lanczos3,
                    fit: 'contain',
                    background: { r: 0, g: 0, b: 0, alpha: 0 }
                })
                .toFile(outputPath);

            console.log(`✓ Generated icon${size}.png`);
        } catch (err) {
            console.error(`✗ Failed to generate icon${size}.png:`, err.message);
        }
    }

    console.log('\nDone! Icons are in the icons/ directory.');
}

generateIcons();
