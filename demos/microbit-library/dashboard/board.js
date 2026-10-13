// The micro:bit on the other end of a WebSerial port: one JSON object per line from the board,
// one command per line to it. Fires "message" (detail: the parsed object), "connected" and
// "disconnected" events.
//
// Opening the port restarts the micro:bit (its USB interface chip does that), so the board
// greets with "hello" on its own; HELLO is only sent when that greeting does not arrive.

const MICROBIT_USB_VENDOR = 0x0d28;   // Arm DAPLink, the micro:bit's USB interface chip

export class Board extends EventTarget {
    #port = null;
    #reader = null;
    #writer = null;
    #closed = null;
    #greeted = false;

    static get supported() {
        return "serial" in navigator;
    }

    get connected() {
        return this.#port != null;
    }

    async connect() {
        const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: MICROBIT_USB_VENDOR }] });
        await port.open({ baudRate: 115200 });
        this.#port = port;
        this.#greeted = false;
        this.#writer = port.writable.getWriter();
        navigator.serial.addEventListener("disconnect", this.#onUnplug);
        this.#closed = this.#readLines(port);
        this.dispatchEvent(new Event("connected"));
        for (let attempt = 0; attempt < 3 && !this.#greeted && this.connected; attempt++) {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            if (!this.#greeted && this.connected) await this.send("HELLO");
        }
    }

    async send(command) {
        if (!this.#writer) throw new Error("The board is not connected.");
        await this.#writer.write(new TextEncoder().encode(command + "\n"));
    }

    async disconnect() {
        const port = this.#port;
        if (!port) return;
        this.#port = null;
        navigator.serial.removeEventListener("disconnect", this.#onUnplug);
        try { await this.#reader?.cancel(); } catch { /* already gone */ }
        await this.#closed;
        try { this.#writer?.releaseLock(); } catch { /* already gone */ }
        this.#writer = null;
        try { await port.close(); } catch { /* unplugged */ }
        this.dispatchEvent(new Event("disconnected"));
    }

    #onUnplug = (event) => {
        if (event.target === this.#port) this.disconnect();
    };

    async #readLines(port) {
        const decoder = new TextDecoderStream();
        const piped = port.readable.pipeTo(decoder.writable).catch(() => {});
        this.#reader = decoder.readable.getReader();
        let buffer = "";
        try {
            for (;;) {
                const { value, done } = await this.#reader.read();
                if (done) break;
                buffer += value;
                let end;
                while ((end = buffer.indexOf("\n")) >= 0) {
                    const line = buffer.slice(0, end).trim();
                    buffer = buffer.slice(end + 1);
                    if (line) this.#handle(line);
                }
            }
        } catch {
            // the port went away; disconnect() tidies up
        } finally {
            this.#reader.releaseLock();
            this.#reader = null;
        }
        await piped;
        if (this.#port === port) this.disconnect();
    }

    #handle(line) {
        let message;
        try {
            message = JSON.parse(line);
        } catch {
            return;   // half a line from before the port opened
        }
        if (message.type === "hello") this.#greeted = true;
        this.dispatchEvent(new CustomEvent("message", { detail: message }));
    }
}
