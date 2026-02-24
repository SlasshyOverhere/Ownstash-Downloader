import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, 'src-tauri', 'icons', 'ownstash downloader with bg.png');
const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

function getDarkPixelRanges(raw, width, height, channels, threshold = 80, minPixelsPerRow = 20) {
    const rows = [];

    for (let y = 0; y < height; y++) {
        let darkCount = 0;
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            const r = raw[i];
            const g = raw[i + 1];
            const b = raw[i + 2];
            if (r < threshold && g < threshold && b < threshold) {
                darkCount++;
            }
        }
        if (darkCount > minPixelsPerRow) {
            rows.push(y);
        }
    }

    const ranges = [];
    let start = null;
    let prev = null;

    for (const y of rows) {
        if (start === null) {
            start = y;
            prev = y;
            continue;
        }

        if (y === prev + 1) {
            prev = y;
            continue;
        }

        ranges.push([start, prev]);
        start = y;
        prev = y;
    }

    if (start !== null) {
        ranges.push([start, prev]);
    }

    return ranges;
}

async function prepareIconBaseBuffer() {
    const { data, info } = await sharp(inputPath)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    const ranges = getDarkPixelRanges(data, width, height, channels);

    if (ranges.length === 0) {
        return sharp(inputPath).ensureAlpha().png().toBuffer();
    }

    // Use the first dark blob (logo symbol), ignoring lower text blobs.
    const [y1, y2] = ranges[0];

    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;

    for (let y = y1; y <= y2; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * channels;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            if (r < 80 && g < 80 && b < 80) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }

    const symbolW = maxX - minX + 1;
    const symbolH = maxY - minY + 1;
    const side = Math.max(symbolW, symbolH);
    const cx = Math.floor((minX + maxX) / 2);
    const cy = Math.floor((minY + maxY) / 2);

    let left = cx - Math.floor(side / 2);
    let top = cy - Math.floor(side / 2);

    left = Math.max(0, Math.min(left, width - side));
    top = Math.max(0, Math.min(top, height - side));

    const radius = Math.round(side * 0.2);
    const maskSvg = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${side}" height="${side}">` +
        `<rect x="0" y="0" width="${side}" height="${side}" rx="${radius}" ry="${radius}" fill="white"/>` +
        '</svg>'
    );

    const padding = Math.round(side * 0.12);

    return sharp(inputPath)
        .extract({ left, top, width: side, height: side })
        .ensureAlpha()
        .composite([{ input: maskSvg, blend: 'dest-in' }])
        .extend({
            top: padding,
            bottom: padding,
            left: padding,
            right: padding,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer();
}

async function generateIcons() {
    // Ensure icons directory exists
    if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
    }

    // Prepare a zoomed, symbol-only base icon for better small-size readability.
    const baseBuffer = await prepareIconBaseBuffer();
    const image = sharp(baseBuffer);

    // Generate various sizes
    const sizes = [
        { name: '32x32.png', size: 32 },
        { name: '128x128.png', size: 128 },
        { name: '128x128@2x.png', size: 256 },
        { name: 'icon.png', size: 512 },
    ];

    for (const { name, size } of sizes) {
        await image
            .clone()
            .resize(size, size, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
            .png()
            .toFile(path.join(iconsDir, name));
        console.log(`Generated ${name}`);
    }

    // Generate ICO for Windows (contains multiple sizes as PNG)
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const icoImages = await Promise.all(
        icoSizes.map(async (size) => {
            return await image
                .clone()
                .resize(size, size, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
                .png()
                .toBuffer();
        })
    );

    const icoBuffer = createIco(icoImages, icoSizes);
    fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);
    console.log('Generated icon.ico');

    // Copy the largest as icns placeholder (macOS would need proper conversion)
    await image
        .clone()
        .resize(512, 512, { fit: 'contain', kernel: sharp.kernel.lanczos3 })
        .png()
        .toFile(path.join(iconsDir, 'icon.icns'));
    console.log('Generated icon.icns (placeholder)');

    console.log('All icons generated successfully!');
}

function createIco(images, sizes) {
    const numImages = images.length;
    const headerSize = 6;
    const dirEntrySize = 16;
    const dirSize = dirEntrySize * numImages;

    let dataOffset = headerSize + dirSize;
    const entries = [];

    for (let i = 0; i < numImages; i++) {
        const size = sizes[i];
        const data = images[i];

        entries.push({
            width: size === 256 ? 0 : size,
            height: size === 256 ? 0 : size,
            dataSize: data.length,
            dataOffset: dataOffset,
        });

        dataOffset += data.length;
    }

    const totalSize = headerSize + dirSize + images.reduce((sum, d) => sum + d.length, 0);
    const buffer = Buffer.alloc(totalSize);
    let offset = 0;

    // ICO Header
    buffer.writeUInt16LE(0, offset); offset += 2;
    buffer.writeUInt16LE(1, offset); offset += 2;
    buffer.writeUInt16LE(numImages, offset); offset += 2;

    // Directory entries
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        buffer.writeUInt8(entry.width, offset); offset += 1;
        buffer.writeUInt8(entry.height, offset); offset += 1;
        buffer.writeUInt8(0, offset); offset += 1;  // colorCount
        buffer.writeUInt8(0, offset); offset += 1;  // reserved
        buffer.writeUInt16LE(1, offset); offset += 2;  // planes
        buffer.writeUInt16LE(32, offset); offset += 2;  // bitCount
        buffer.writeUInt32LE(entry.dataSize, offset); offset += 4;
        buffer.writeUInt32LE(entry.dataOffset, offset); offset += 4;
    }

    // Image data
    for (const data of images) {
        data.copy(buffer, offset);
        offset += data.length;
    }

    return buffer;
}

generateIcons().catch(console.error);
