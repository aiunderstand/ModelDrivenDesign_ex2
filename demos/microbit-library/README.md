# The library on a micro:bit

[Example 6](../../examples/6-sequence-library/)'s lending classes (`Library`, `Catalog`,
`Book`, `Member`, `Loan`) running on a BBC micro:bit v2, plus a web dashboard that talks to the
board over WebSerial. The dashboard keeps the lending history in the browser and lets you ask
Claude questions about it.

- **Button A** lends the selected book, **button B** returns it. Each press gives a short beep
  on the built-in speaker: high when the library agrees, low when it refuses (a book that is
  already out, or one that is not).
- **Tilt** the board left or right to choose one of the five books, **A** to **E**. Hold it
  tilted and the selection keeps moving.
- The **5×5 display** shows the selected book's letter, dimmed while that book is on loan.
- The **USB serial port** reports every action to the dashboard, which can send commands back.

**Dashboard:** <https://aiunderstand.github.io/ModelDrivenDesign_ex2/microbit/> (published on
every push to `main`; needs Chrome or Edge on a computer to connect a board).

```
lending/include/lending/*.hpp   the class headers, identical to example 6's
lending/src/*.cpp               their sources, with example 6's three deliberate mistakes fixed
firmware/main.cpp               the hardware: buttons, tilt, speaker, display, serial
firmware/build.sh               builds firmware/MICROBIT.hex with CODAL; --flash copies it to the board
firmware/codal.json             the CODAL target, pinned to codal-microbit-v2 v0.3.5
dashboard/                      the web page: plain HTML and JavaScript modules, no build step
```

## The classes

The headers are copied unchanged from example 6. The sources fix its three deliberate mistakes:
`lend()` finds the member before it marks the book on loan, it no longer asks the book for its
title, and `giveBack()` calls `markReturned()`. Checked with this repository's verifier against
example 6's diagrams, the class diagram, *lend book* and *return book* are all at 100 %. Two
C++17/20 calls (`insert_or_assign`, `std::erase_if`) became C++11 equivalents, because CODAL
compiles with `-std=c++11`.

`main.cpp` creates a `Library` with five books and one member (`m1`, Ada) and calls `lend()` and
`giveBack()`. `Library` answers `lend()` with yes or no but has no query for which books are
out, so the firmware remembers that itself in order to dim the display.

## Build and flash

```sh
demos/microbit-library/firmware/build.sh --flash
```

You need git, Python 3 and CMake (Ninja is used when present). The first run downloads the Arm
GNU toolchain (about 130 MB) and CODAL's libraries into `firmware/.build/`, which takes a few
minutes. After that, a build takes seconds. `--flash` copies `MICROBIT.hex` onto the `MICROBIT`
drive; without it, drag the file there yourself. The Pages site also offers the `.hex` for
download.

## The dashboard

Open it from GitHub Pages, or locally:

```sh
python3 -m http.server -d demos/microbit-library/dashboard 8000   # then open http://localhost:8000
```

WebSerial only works on `https://` or `localhost` pages, in Chrome or Edge. **Connect micro:bit**
asks for the port. The history and the questions also work without a board: **Add sample data**
fills in four weeks of made-up loans.

- **Shelf:** the board's display mirrored, the five books with their status and number of
  loans, and **Lend** / **Return** buttons that send the same commands as the board's buttons.
  Clicking a book selects it on the board.
- **Ask the history:** questions such as *How often has this book been loaned?* go to Claude
  (`claude-opus-5-5`) together with the selected book. Claude cannot see the database. It gets
  three read-only tools (`loan_stats`, `list_loans` and `list_events`) that run Dexie queries
  in your browser, and answers from what they return. The queries it ran are listed under the
  answer. You need your own Anthropic API key, which you paste into the page; the browser sends
  it straight to `api.anthropic.com`. Each question costs a few cents of API usage.
- **Activity:** what happened, newest first.
- **Database:** the IndexedDB database `microbit-library`, through [Dexie.js](https://dexie.org):
  browse the tables, delete a row, export or import everything as JSON, or clear it.

| Table | One row per | Fields |
|---|---|---|
| `books` | book the board announced | `id`, `title` |
| `loans` | loan; open while `returnedAt` is empty | `id`, `book`, `member`, `lentAt`, `returnedAt`, `origin` |
| `events` | lend or return the board reported, refused ones too | `id`, `at`, `type`, `book`, `member`, `ok`, `source` |

**The board forgets, the database does not.** The micro:bit's USB chip restarts the board
whenever the serial port is opened, so a freshly connected board has every book on the shelf.
On connecting, the dashboard sends `SYNC` with the books that its database still has on loan.
Loans the board reports that the database does not know about (made while the dashboard was
closed) are recorded with `origin: "offline"`.

## Serial protocol

115200 baud, one line per message, `\n`-terminated.

From the board, as JSON:

| `type` | When | Other fields |
|---|---|---|
| `hello` | at start-up, and on `HELLO` | `firmware`, `member`, `books: [{id, title}]` |
| `state` | after `hello`, and after `SYNC` | `selected`, `onLoan` (the letters out, e.g. `"AC"`) |
| `select` | the selection changed | `book` |
| `lend`, `return` | a button or command was handled | `book`, `member`, `ok`, `source` (`button` or `web`) |
| `error` | an unknown command | `message` |

To the board, as text (case does not matter):

| Command | Does |
|---|---|
| `HELLO` | answers with `hello` and `state` |
| `SELECT C` | selects book C |
| `LEND C` / `RETURN C` | selects book C and presses A or B for it |
| `SYNC AC` | puts A and C on loan without beeping, then answers with `state` |
