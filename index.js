const { SerialPort } = require('serialport');
const { TuringSmartScreen, Orientation } = require('./turingLib');
const { ClockWidget } = require('./widgets');

SerialPort.list().then(
    (ports) => console.log(ports),
    (err) => console.log(err)
);

const screen = new TuringSmartScreen('COM8');
const clock = new ClockWidget( 230, 70, 128, 32); // Top of screen

(async () => {
    try {
        console.log("Opening screen...");
        await screen.open();
        console.log("Screen opened.");

        await screen.setOrientation(Orientation.PORTRAIT);
        await screen.setBrightness(255);
        await screen.clear();
        await screen.setOrientation(Orientation.LANDSCAPE);

        // Draw background once
        console.log("Setting background...");
        try {
            await screen.setBackground('./bg.jpg');
        } catch (e) {
            console.log("Background error:", e);
        }

        console.log("Starting clock loop...");
        setInterval(async () => {
            try {
                await screen.drawWidget(clock);
            } catch (e) {
                console.error("Error updating clock:", e);
            }
        }, 1000);

    } catch (err) {
        console.error("Error:", err);
    }
})();
