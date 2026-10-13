// The example-6 library on a micro:bit v2.
//
// Button A lends the selected book, button B takes it back, each with a short beep: high when
// the library agrees, low when it refuses. Tilting the board left or right selects another of
// the five books A-E, shown on the 5x5 display, dimmed while the book is on loan.
//
// Every action is reported on the USB serial port (115200 baud) as one JSON object per line,
// for the WebSerial dashboard, which can send commands back. The protocol is in README.md.
#include <cstdio>
#include <cstring>
#include <string>

#include "MicroBit.h"
#include "lending/library.hpp"

MicroBit uBit;

namespace {

const int kBooks = 5;
const char* const kTitles[kBooks] = {"Accelerando", "Brave New World", "Cryptonomicon", "Dune", "Emma"};
const char* const kMemberId = "m1";
const char* const kMemberName = "Ada";

const int kTiltOn = 450;         // mg: this far over, and the selection moves
const int kTiltOff = 200;        // mg: back within this, and the board is level again
const int kTiltRepeatMs = 700;   // held tilted, the selection keeps moving at this pace

lending::Library library;
bool onLoan[kBooks] = {};   // Library answers lend() with yes or no; the board remembers which books are out
int selected = 0;
bool sending = false;

std::string bookId(int book) { return std::string(1, static_cast<char>('A' + book)); }

int parseBook(const char* text)
{
    const char c = text[0];
    if (c >= 'A' && c < 'A' + kBooks)
    {
        return c - 'A';
    }
    return -1;
}

void send(const char* line)
{
    // Fibers take turns; keep one line from interleaving with another.
    while (sending)
    {
        uBit.sleep(1);
    }
    sending = true;
    uBit.serial.send(ManagedString(line), SYNC_SLEEP);
    sending = false;
}

void sendHello()
{
    char line[256];
    int n = snprintf(line, sizeof line, "{\"type\":\"hello\",\"firmware\":\"lending-microbit 1.0\",\"member\":\"%s\",\"books\":[", kMemberId);
    for (int book = 0; book < kBooks; ++book)
    {
        n += snprintf(line + n, sizeof line - n, "%s{\"id\":\"%c\",\"title\":\"%s\"}", book == 0 ? "" : ",", 'A' + book, kTitles[book]);
    }
    snprintf(line + n, sizeof line - n, "]}\n");
    send(line);
}

void sendState()
{
    char out[kBooks + 1];
    int n = 0;
    for (int book = 0; book < kBooks; ++book)
    {
        if (onLoan[book])
        {
            out[n++] = static_cast<char>('A' + book);
        }
    }
    out[n] = '\0';
    char line[80];
    snprintf(line, sizeof line, "{\"type\":\"state\",\"selected\":\"%c\",\"onLoan\":\"%s\"}\n", 'A' + selected, out);
    send(line);
}

void sendEvent(const char* type, int book, bool ok, const char* source)
{
    char line[120];
    snprintf(line, sizeof line, "{\"type\":\"%s\",\"book\":\"%c\",\"member\":\"%s\",\"ok\":%s,\"source\":\"%s\"}\n",
             type, 'A' + book, kMemberId, ok ? "true" : "false", source);
    send(line);
}

void sendError(const char* message)
{
    char line[80];
    snprintf(line, sizeof line, "{\"type\":\"error\",\"message\":\"%s\"}\n", message);
    send(line);
}

void show()
{
    uBit.display.setBrightness(onLoan[selected] ? 40 : 255);
    uBit.display.printChar(static_cast<char>('A' + selected));
}

void beep(bool ok)
{
    uBit.audio.virtualOutputPin.setAnalogValue(127);
    uBit.audio.virtualOutputPin.setAnalogPeriodUs(1000000 / (ok ? 1760 : 440));
    uBit.sleep(80);
    uBit.audio.virtualOutputPin.setAnalogValue(0);
}

void select(int book)
{
    selected = (book + kBooks) % kBooks;
    show();
    char line[48];
    snprintf(line, sizeof line, "{\"type\":\"select\",\"book\":\"%c\"}\n", 'A' + selected);
    send(line);
}

void lend(int book, const char* source)
{
    const bool ok = library.lend(bookId(book), kMemberId);
    if (ok)
    {
        onLoan[book] = true;
    }
    show();
    sendEvent("lend", book, ok, source);
    beep(ok);
}

void giveBack(int book, const char* source)
{
    const bool ok = onLoan[book];   // giveBack() returns nothing: only a book on loan comes back
    library.giveBack(bookId(book));
    onLoan[book] = false;
    show();
    sendEvent("return", book, ok, source);
    beep(ok);
}

// Puts the books the dashboard remembers as lent back on loan, after the board was reset.
void sync(const char* books)
{
    for (const char* c = books; *c != '\0'; ++c)
    {
        const int book = parseBook(c);
        if (book >= 0 && !onLoan[book] && library.lend(bookId(book), kMemberId))
        {
            onLoan[book] = true;
        }
    }
    show();
    sendState();
}

void handleCommand(const char* raw)
{
    char command[40];
    std::size_t n = 0;
    for (; raw[n] != '\0' && n < sizeof command - 1; ++n)
    {
        const char c = raw[n];
        command[n] = (c >= 'a' && c <= 'z') ? static_cast<char>(c - 'a' + 'A') : c;
    }
    while (n > 0 && (command[n - 1] == '\r' || command[n - 1] == ' '))
    {
        --n;
    }
    command[n] = '\0';
    if (n == 0)
    {
        return;
    }

    if (strcmp(command, "HELLO") == 0)
    {
        sendHello();
        sendState();
        return;
    }
    if (strncmp(command, "SYNC", 4) == 0)
    {
        sync(command + 4);
        return;
    }

    const char* argument = strchr(command, ' ');
    const int book = argument == nullptr ? -1 : parseBook(argument + 1);
    if (book < 0)
    {
        sendError("unknown command or book");
    }
    else if (strncmp(command, "LEND ", 5) == 0)
    {
        select(book);
        lend(book, "web");
    }
    else if (strncmp(command, "RETURN ", 7) == 0)
    {
        select(book);
        giveBack(book, "web");
    }
    else if (strncmp(command, "SELECT ", 7) == 0)
    {
        select(book);
    }
    else
    {
        sendError("unknown command or book");
    }
}

void onButtonA(MicroBitEvent) { lend(selected, "button"); }

void onButtonB(MicroBitEvent) { giveBack(selected, "button"); }

void tiltLoop()
{
    bool level = false;   // nothing moves until the board has been level once
    bool armed = false;
    unsigned long lastStep = 0;
    while (true)
    {
        const int x = uBit.accelerometer.getX();
        const unsigned long now = uBit.systemTime();
        const int direction = x > kTiltOn ? 1 : (x < -kTiltOn ? -1 : 0);
        if (armed && direction != 0 && (level || now - lastStep >= kTiltRepeatMs))
        {
            select(selected + direction);
            level = false;
            lastStep = now;
        }
        else if (x > -kTiltOff && x < kTiltOff)
        {
            level = true;
            armed = true;
        }
        uBit.sleep(50);
    }
}

void serialLoop()
{
    while (true)
    {
        ManagedString line = uBit.serial.readUntil(ManagedString("\n"), SYNC_SLEEP);
        handleCommand(line.toCharArray());
    }
}

}  // namespace

int main()
{
    uBit.init();
    uBit.serial.setRxBufferSize(64);
    uBit.serial.setTxBufferSize(128);

    for (int book = 0; book < kBooks; ++book)
    {
        library.addBook(bookId(book), kTitles[book]);
    }
    library.enrol(kMemberId, kMemberName);

    uBit.messageBus.listen(MICROBIT_ID_BUTTON_A, MICROBIT_BUTTON_EVT_CLICK, onButtonA);
    uBit.messageBus.listen(MICROBIT_ID_BUTTON_B, MICROBIT_BUTTON_EVT_CLICK, onButtonB);

    show();
    sendHello();
    sendState();

    create_fiber(tiltLoop);
    create_fiber(serialLoop);
    release_fiber();
}
