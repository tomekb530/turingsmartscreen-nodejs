const { SerialPort } = require('serialport');
const { Jimp, loadFont } = require("jimp");
const path = require('path');

const Orientation = {
    PORTRAIT: 0,
    REVERSE_PORTRAIT: 1,
    LANDSCAPE: 2,
    REVERSE_LANDSCAPE: 3
};

class TuringSmartScreen {
    constructor(portName) {
        this.port = new SerialPort({
            path: portName,
            baudRate: 115200,
            autoOpen: false,
            dataBits: 8,
            stopBits: 1,
            parity: 'none'
        });
        this.writeBuffer = Buffer.alloc(16);
        this.width = 320;
        this.height = 480;
        this.backgroundImage = null;
    }

    open() {
        return new Promise((resolve, reject) => {
            this.port.open((err) => {
                if (err) return reject(err);
                // Discard buffers logic if needed, but SerialPort usually handles fresh start
                resolve();
            });
        });
    }

    close() {
        if (this.port.isOpen) {
            this.port.close();
        }
    }

    dispose() {
        this.close();
        this.writeBuffer = null;
    }

    _write(data) {
        return new Promise((resolve, reject) => {
            this.port.write(data, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    async _writeCommand(command, level) {
        // Overload: WriteCommand(byte command)
        if (level === undefined) {
            this.writeBuffer.fill(0, 0, 6);
            this.writeBuffer[5] = command;
            await this._write(this.writeBuffer.subarray(0, 6));
            return;
        }

        // Overload: WriteCommand(byte command, int level)
        this.writeBuffer.fill(0, 0, 6);
        this.writeBuffer[0] = (level >> 2);
        this.writeBuffer[1] = ((level & 3) << 6);
        this.writeBuffer[5] = command;
        await this._write(this.writeBuffer.subarray(0, 6));
    }

    async _writeCommandOrientation(command, orientation, width, height) {
        this.writeBuffer.fill(0, 0, 11);
        this.writeBuffer[5] = command;
        this.writeBuffer[6] = (orientation + 100);
        this.writeBuffer[7] = (width >> 8);
        this.writeBuffer[8] = (width & 255);
        this.writeBuffer[9] = (height >> 8);
        this.writeBuffer[10] = (height & 255);

        await this._write(this.writeBuffer.subarray(0, 11));
    }

    async _writeCommandBitmap(command, x, y, width, height, data) {
        const ex = x + width - 1;
        const ey = y + height - 1;

        this.writeBuffer.fill(0, 0, 6);
        this.writeBuffer[0] = (x >> 2);
        this.writeBuffer[1] = (((x & 3) << 6) + (y >> 4));
        this.writeBuffer[2] = (((y & 15) << 4) + (ex >> 6));
        this.writeBuffer[3] = (((ex & 63) << 2) + (ey >> 8));
        this.writeBuffer[4] = (ey & 255);
        this.writeBuffer[5] = command;

        await this._write(this.writeBuffer.subarray(0, 6));

        // Write data in chunks
        // Sending in chunks to avoid overwhelming the serial port
        const chunkSize = 4096;
        for (let i = 0; i < data.length; i += chunkSize) {
            const chunk = data.subarray(i, i + chunkSize);
            await this._write(chunk);
            // Add a small delay if needed
            // await new Promise(r => setTimeout(r, 1)); 
        }
    }

    async reset() {
        await this._writeCommand(101);
    }

    async clear() {
        await this._writeCommand(102);
    }

    async screenOff() {
        await this._writeCommand(108);
    }

    async screenOn() {
        await this._writeCommand(109);
    }

    async setBrightness(level) {
        // Invert brightness if needed (common for these screens: 255=dark, 0=bright)
        // Adjust based on user feedback "weirdly dark" with 255 input.
        if (level > 255) level = 255;
        if (level < 0) level = 0;
        level = 255 - level;
        await this._writeCommand(110, level);
    }

    async setOrientation(orientation, width = 320, height = 480) { // Default to class props if needed, or overridden
        await this._writeCommandOrientation(121, orientation, width, height);
    }

    async displayBitmap(x, y, width, height, bitmap) {
        await this._writeCommandBitmap(197, x, y, width, height, bitmap);
    }

    // Helper functions (image processing)
    _imageToRGB565(image) {
        const width = image.bitmap.width;
        const height = image.bitmap.height;
        const buffer = Buffer.alloc(width * height * 2);

        image.scan(0, 0, width, height, function (x, y, idx) {
            const r = this.bitmap.data[idx + 0];
            const g = this.bitmap.data[idx + 1];
            const b = this.bitmap.data[idx + 2];

            // RGB565 conversion
            const rgb565 = ((r & 0b11111000) << 8) | ((g & 0b11111100) << 3) | (b >> 3);

            // Little Endian
            const offset = (y * width + x) * 2;
            buffer.writeUInt16LE(rgb565, offset);
        });
        return buffer;
    }

    async displayImage(imagePath, x = 0, y = 0) {
        try {
            const image = await Jimp.read(imagePath);

            const displayWidth = 480; // Assuming display width 
            const displayHeight = 320; // Assuming display height

            let image_width = image.bitmap.width;
            let image_height = image.bitmap.height;

            // If our image size + the (x, y) position offsets are bigger than
            // our display, reduce the image size to fit our screen
            if (x + image_width > displayWidth) {
                image_width = displayWidth - x;
            }
            if (y + image_height > displayHeight) {
                image_height = displayHeight - y;
            }

            if (image_width !== image.bitmap.width || image_height !== image.bitmap.height) {
                image.crop({ x: 0, y: 0, w: image_width, h: image_height });
            }

            const rgb565 = this._imageToRGB565(image);
            await this.displayBitmap(x, y, image.bitmap.width, image.bitmap.height, rgb565);
            console.log(`Image ${imagePath} sent to display.`);

        } catch (err) {
            console.error("Error drawing image:", err);
        }
    }

    async setBackground(imagePath) {
        try {
            const image = await Jimp.read(imagePath);
            
            // Assuming landscape 480x320 for now as per index.js usage, 
            // ideally we should track current orientation dimensions.
            const screenW = 480;
            const screenH = 320;

            // Resize to cover screen
            image.cover({ w: screenW, h: screenH });

            // Store for widget composition
            this.backgroundImage = image.clone();

            // Display it
            const rgb565 = this._imageToRGB565(image);
            await this.displayBitmap(0, 0, screenW, screenH, rgb565);
            console.log(`Background set to ${imagePath}`);
        } catch (err) {
            console.error("Error setting background:", err);
        }
    }

    async drawWidget(widget) {
        let { buffer, width, height, image } = await widget.render();

        if (this.backgroundImage && image) {
            try {
                // If we have a background, crop the area where the widget will be
                // and composite the widget on top of it.
                // Assuming this.backgroundImage is at (0,0) or check offset if needed, 
                // but displayImage usually draws at optional x,y. 
                // We'll simplify and assume background starts at 0,0 for full screen BG use case.

                // Crop background at widget position
                const bgPatch = this.backgroundImage.clone();
                // Ensure crop is within bounds
                if (widget.x < bgPatch.bitmap.width && widget.y < bgPatch.bitmap.height) {
                    bgPatch.crop({ x: widget.x, y: widget.y, w: width, h: height });
                    
                    // Composite widget (which has transparent background) onto the background patch
                    bgPatch.composite(image, 0, 0);

                    // Convert the blended result to RGB565
                    buffer = this._imageToRGB565(bgPatch);
                }
            } catch (e) {
                console.error("Error compositing widget on background:", e);
            }
        }

        await this.displayBitmap(widget.x, widget.y, width, height, buffer);
    }
}

module.exports = { TuringSmartScreen, Orientation };
