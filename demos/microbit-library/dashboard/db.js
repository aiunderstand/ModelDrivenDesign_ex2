// The dashboard's memory: an IndexedDB database, through Dexie.
//
//   books   one row per book, as the board announces them      { id, title }
//   loans   one row per loan, open while returnedAt is null    { id, book, member, lentAt, returnedAt, origin }
//   events  every lend or return the board reports, refused too { id, at, type, book, member, ok, source }
//
// Times are milliseconds since 1970 (Date.now()).
import Dexie from "https://cdn.jsdelivr.net/npm/dexie@4.4.6/dist/dexie.mjs";

export const db = new Dexie("microbit-library");
db.version(1).stores({
    books: "id",
    loans: "++id, book, member, lentAt, returnedAt",
    events: "++id, at, type, book",
});

export const TABLES = ["books", "loans", "events"];

export async function saveBooks(books) {
    await db.books.bulkPut(books.map(({ id, title }) => ({ id, title })));
}

export async function openLoans() {
    return db.loans.filter((loan) => loan.returnedAt == null).toArray();
}

// A lend or return reported by the board: log it, and open or close the loan it changes.
export async function recordEvent({ type, book, member, ok, source }, at = Date.now()) {
    await db.transaction("rw", db.events, db.loans, async () => {
        await db.events.add({ at, type, book, member, ok, source });
        if (!ok) return;
        if (type === "lend") {
            await db.loans.add({ book, member, lentAt: at, returnedAt: null, origin: "board" });
        } else if (type === "return") {
            const open = await db.loans.where("book").equals(book).filter((loan) => loan.returnedAt == null).toArray();
            for (const loan of open) await db.loans.update(loan.id, { returnedAt: at });
        }
    });
}

// The board forgets its loans when it restarts; the database does not. Compares the two after
// connecting: returns the books the board should be told are on loan (for SYNC), and records
// loans the board made while the dashboard was away.
export async function reconcile(onBoard, member, at = Date.now()) {
    const open = new Set((await openLoans()).map((loan) => loan.book));
    const restore = [...open].filter((book) => !onBoard.includes(book)).sort();
    const adopted = onBoard.filter((book) => !open.has(book));
    for (const book of adopted) {
        await db.loans.add({ book, member, lentAt: at, returnedAt: null, origin: "offline" });
    }
    return { restore, adopted };
}

export async function loanCounts() {
    const counts = {};
    await db.loans.each((loan) => { counts[loan.book] = (counts[loan.book] ?? 0) + 1; });
    return counts;
}

// ---------------------------------------------------------------- queries, for Claude's tools

const DAY = 86_400_000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function inRange(time, from, to) {
    return (from == null || time >= from) && (to == null || time < to);
}

function iso(time) {
    return time == null ? null : new Date(time).toISOString();
}

function minutesKept(loan) {
    return loan.returnedAt == null ? null : Math.round((loan.returnedAt - loan.lentAt) / 60_000);
}

// Loans filtered by book, the time they were lent, and whether they are back. Returns the rows
// and the Dexie query that found them, so the page can show what ran.
export async function findLoans({ book, from, to, status = "any" } = {}) {
    let query = book ? `db.loans.where("book").equals("${book}")` : "db.loans";
    let collection = book ? db.loans.where("book").equals(book) : db.loans.toCollection();
    const tests = [];
    if (from != null || to != null) tests.push(`lentAt in [${iso(from) ?? "…"}, ${iso(to) ?? "…"})`);
    if (status === "open") tests.push("returnedAt == null");
    if (status === "returned") tests.push("returnedAt != null");
    if (tests.length) {
        collection = collection.filter((loan) =>
            inRange(loan.lentAt, from, to) &&
            (status === "any" || (status === "open") === (loan.returnedAt == null)));
        query += `.filter(${tests.join(" && ")})`;
    }
    const loans = await collection.toArray();
    return { loans, query: `${query}.toArray()` };
}

export async function findEvents({ type, book, ok, from, to } = {}) {
    let query = book ? `db.events.where("book").equals("${book}")` : "db.events";
    let collection = book ? db.events.where("book").equals(book) : db.events.toCollection();
    const tests = [];
    if (type) tests.push(`type == "${type}"`);
    if (ok != null) tests.push(`ok == ${ok}`);
    if (from != null || to != null) tests.push(`at in [${iso(from) ?? "…"}, ${iso(to) ?? "…"})`);
    if (tests.length) {
        collection = collection.filter((event) =>
            (!type || event.type === type) && (ok == null || event.ok === ok) && inRange(event.at, from, to));
        query += `.filter(${tests.join(" && ")})`;
    }
    const events = await collection.toArray();
    return { events, query: `${query}.toArray()` };
}

export function loanRow(loan, titles) {
    return {
        id: loan.id,
        book: loan.book,
        title: titles[loan.book] ?? null,
        member: loan.member,
        lentAt: iso(loan.lentAt),
        returnedAt: iso(loan.returnedAt),
        minutesKept: minutesKept(loan),
        origin: loan.origin,
    };
}

export function eventRow(event) {
    return { id: event.id, at: iso(event.at), type: event.type, book: event.book, member: event.member, ok: event.ok, source: event.source };
}

// Loans grouped by book, member, day, weekday or hour of the day (in the viewer's time zone).
export function groupLoans(loans, groupBy) {
    const keyOf = {
        book: (loan) => loan.book,
        member: (loan) => loan.member,
        day: (loan) => new Date(loan.lentAt).toLocaleDateString("sv"),   // YYYY-MM-DD
        weekday: (loan) => WEEKDAYS[new Date(loan.lentAt).getDay()],
        hour: (loan) => String(new Date(loan.lentAt).getHours()).padStart(2, "0") + ":00",
    }[groupBy];
    const groups = new Map();
    for (const loan of loans) {
        const key = keyOf(loan);
        const group = groups.get(key) ?? { key, loans: 0, open: 0, returned: 0, totalMinutes: 0 };
        group.loans += 1;
        if (loan.returnedAt == null) {
            group.open += 1;
        } else {
            group.returned += 1;
            group.totalMinutes += minutesKept(loan);
        }
        groups.set(key, group);
    }
    return [...groups.values()]
        .map(({ totalMinutes, ...group }) => ({
            ...group,
            averageMinutesKept: group.returned ? Math.round(totalMinutes / group.returned) : null,
        }))
        .sort((a, b) => b.loans - a.loans || String(a.key).localeCompare(String(b.key)));
}

// ---------------------------------------------------------------- the database manager

export async function counts() {
    const result = {};
    for (const table of TABLES) result[table] = await db.table(table).count();
    return result;
}

export async function rows(table, limit = 200) {
    const t = db.table(table);
    return table === "books" ? t.toArray() : t.reverse().limit(limit).toArray();
}

export async function deleteRow(table, key) {
    await db.table(table).delete(key);
}

export async function exportAll() {
    const data = { format: "microbit-library", version: 1, exportedAt: iso(Date.now()) };
    for (const table of TABLES) data[table] = await db.table(table).toArray();
    return data;
}

export async function importAll(data) {
    if (data?.format !== "microbit-library") throw new Error("This is not a microbit-library export.");
    await db.transaction("rw", TABLES.map((table) => db.table(table)), async () => {
        for (const table of TABLES) {
            await db.table(table).clear();
            await db.table(table).bulkAdd(data[table] ?? []);
        }
    });
}

export async function clearAll() {
    await db.transaction("rw", TABLES.map((table) => db.table(table)), async () => {
        for (const table of TABLES) await db.table(table).clear();
    });
}

// Four weeks of made-up lending, for trying the dashboard without a board. Seeded, so every
// run makes the same history relative to now.
export async function addSampleData(books, now = Date.now()) {
    let seed = 6;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const popularity = [5, 2, 4, 3, 1];   // A is a favourite, E is not
    const loans = [];
    const events = [];
    for (let day = 28; day >= 1; day--) {
        books.forEach((book, i) => {
            if (random() * 10 >= popularity[i] * 1.2) return;
            const lentAt = now - day * DAY + Math.round((9 + random() * 8) * 3_600_000);
            const kept = Math.round((20 + random() * 60 * 24 * popularity[i] * 0.6) * 60_000);
            const returnedAt = lentAt + kept < now - DAY / 2 ? lentAt + kept : null;
            if (loans.some((loan) => loan.book === book.id && (loan.returnedAt == null || loan.returnedAt > lentAt))) {
                events.push({ at: lentAt, type: "lend", book: book.id, member: "m1", ok: false, source: "sample" });
                return;
            }
            loans.push({ book: book.id, member: "m1", lentAt, returnedAt, origin: "sample" });
            events.push({ at: lentAt, type: "lend", book: book.id, member: "m1", ok: true, source: "sample" });
            if (returnedAt != null) {
                events.push({ at: returnedAt, type: "return", book: book.id, member: "m1", ok: true, source: "sample" });
            }
        });
    }
    events.sort((a, b) => a.at - b.at);
    await db.transaction("rw", db.books, db.loans, db.events, async () => {
        await db.books.bulkPut(books);
        await db.loans.bulkAdd(loans);
        await db.events.bulkAdd(events);
    });
    return { loans: loans.length, events: events.length };
}
