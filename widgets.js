const { Jimp, loadFont } = require("jimp");
const path = require('path');

class Widget {
    constructor(x, y, width, height) {
        this.x = x;
        this.y = y;
        this.width = width;
        this.height = height;
    }

    async render() {
        throw new Error("Render method must be implemented");
    }
}

class ClockWidget extends Widget {
    constructor(x, y, width = 140, height = 40) {
        super(x, y, width, height);
        this.font = null;
    }

    async preload() {
        // Construct path to font manually since constants are missing in named exports
        // Path: node_modules/@jimp/plugin-print/fonts/open-sans/open-sans-32-white/open-sans-32-white.fnt
        const fontPath = path.join(__dirname, 'node_modules', '@jimp', 'plugin-print', 'fonts', 'open-sans', 'open-sans-32-white', 'open-sans-32-white.fnt');
        this.font = await loadFont(fontPath);
    }

    async render() {
        if (!this.font) {
            try {
                await this.preload();
            } catch (err) {
                console.error("Failed to load font:", err);
                return { buffer: Buffer.alloc(0), width: 0, height: 0 };
            }
        }

        const image = new Jimp({ width: this.width, height: this.height, color: 0x00000000 }); // Transparent background

        const now = new Date();
        const timeString = now.toLocaleTimeString();

        // Alignment constants (Jimp v0 values, assuming valid for v1 or fallback)
        // HORIZONTAL_ALIGN_CENTER = 2
        // VERTICAL_ALIGN_MIDDLE = 16
        image.print({
            font: this.font,
            x: 0,
            y: 0,
            text: timeString,
            alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER,
            alignmentY: Jimp.VERTICAL_ALIGN_MIDDLE
        }); // Default to top-left if alignment constants are unavailable

        // Convert to RGB565
        const buffer = Buffer.alloc(this.width * this.height * 2);
        image.scan(0, 0, this.width, this.height, function (x, y, idx) {
            const r = this.bitmap.data[idx + 0];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];

            /// RGB565 conversion
            const rgb565 = ((r & 0b11111000) << 8) | ((g & 0b11111100) << 3) | (b >> 3);

            // Little Endian
            const offset = (y * this.bitmap.width + x) * 2;
            buffer.writeUInt16LE(rgb565, offset);
        });

        return { buffer, width: this.width, height: this.height, image };
    }
}

module.exports = { Widget, ClockWidget };
