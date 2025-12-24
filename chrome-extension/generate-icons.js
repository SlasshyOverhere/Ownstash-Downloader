/**
 * Icon Generator for Chrome Extension
 * Creates different sized icons from the source 128x128 icon
 * 
 * Usage: node generate-icons.js
 * Requires: sharp package (npm install sharp)
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

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

// If sharp is not installed, provide alternative
try {
    require.resolve('sharp');
    generateIcons();
} catch (e) {
    console.log('Sharp module not found. Creating placeholder icons...');
    console.log('\nTo generate proper icons:');
    console.log('1. npm install sharp');
    console.log('2. node generate-icons.js');
    console.log('\nOr manually create:');
    SIZES.forEach(size => {
        console.log(`  - icons/icon${size}.png (${size}x${size} pixels)`);
    });

    // Copy the 128 icon to other sizes as fallback
    const source = path.join(__dirname, 'icons', 'icon128.png');
    if (fs.existsSync(source)) {
        [16, 32, 48].forEach(size => {
            const dest = path.join(__dirname, 'icons', `icon${size}.png`);
            if (!fs.existsSync(dest)) {
                fs.copyFileSync(source, dest);
                console.log(`Copied icon128.png as icon${size}.png (placeholder)`);
            }
        });
    }
}
