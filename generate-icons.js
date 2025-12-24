import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, 'app-icon.png');
const iconsDir = path.join(__dirname, 'src-tauri', 'icons');

async function generateIcons() {
    // Ensure icons directory exists
    if (!fs.existsSync(iconsDir)) {
        fs.mkdirSync(iconsDir, { recursive: true });
    }

    // Read and convert the source image
    const image = sharp(inputPath);

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
            .resize(size, size)
            .png()
            .toFile(path.join(iconsDir, name));
        console.log(`Generated ${name}`);
    }

    // Generate ICO for Windows (contains multiple sizes as PNG)
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const icoImages = await Promise.all(
        icoSizes.map(async (size) => {
            return await image.clone().resize(size, size).png().toBuffer();
        })
    );

    const icoBuffer = createIco(icoImages, icoSizes);
    fs.writeFileSync(path.join(iconsDir, 'icon.ico'), icoBuffer);
    console.log('Generated icon.ico');

    // Copy the largest as icns placeholder (macOS would need proper conversion)
    await image
        .clone()
        .resize(512, 512)
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
