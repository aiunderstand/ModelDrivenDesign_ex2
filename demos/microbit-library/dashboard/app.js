// Wires the page to the board (board.js), the database (db.js) and Claude (ask.js).
import { Board } from "./board.js";
import * as store from "./db.js";

const BOOKS = [
    { id: "A", title: "Accelerando" },
    { id: "B", title: "Brave New World" },
    { id: "C", title: "Cryptonomicon" },
    { id: "D", title: "Dune" },
    { id: "E", title: "Emma" },
];

// The letters as the board draws them on its 5x5 display.
const GLYPHS = {
    A: [".##..", "#..#.", "####.", "#..#.", "#..#."],
    B: ["###..", "#..#.", "###..", "#..#.", "###.."],
    C: [".###.", "#....", "#....", "#....", ".###."],
    D: ["###..", "#..#.", "#..#.", "#..#.", "###.."],
    E: ["####.", "#....", "###..", "#....", "####."],
};

const SUGGESTIONS = [
    "How often has this book been loaned?",
    "Which book is the most popular?",
    "What is on loan right now, and since when?",
    "How long are books kept on average, per book?",
    "On which weekday is the library busiest?",
    "How many lend attempts were refused?",
];

const TIME_COLUMNS = new Set(["at", "lentAt", "returnedAt"]);
const KEY_STORAGE = "microbit-library.anthropic-key";

const $ = (id) => document.getElementById(id);
const board = new Board();
const state = {
    titles: Object.fromEntries(BOOKS.map((book) => [book.id, book.title])),
    member: "m1",
    selected: "A",
    onLoan: new Set(),
    loanCounts: {},
    reconciled: false,
    table: "loans",
};

// ---------------------------------------------------------------- rendering

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function formatTime(ms) {
    if (ms == null) return "";
    return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function renderMatrix() {
    const glyph = GLYPHS[state.selected] ?? GLYPHS.A;
    const dim = state.onLoan.has(state.selected);
    $("matrix").classList.toggle("dim", dim);
    $("matrix").setAttribute("aria-label", `The board shows ${state.selected}${dim ? ", dimmed: on loan" : ""}`);
    $("matrix").innerHTML = glyph.join("").split("").map((c) => `<span class="${c === "#" ? "on" : ""}"></span>`).join("");
}

function renderShelf() {
    renderMatrix();
    const out = state.onLoan.has(state.selected);
    $("current-title").textContent = `${state.selected} · ${state.titles[state.selected] ?? ""}`;
    $("current-status").textContent = out ? "On loan" : "On the shelf";
    $("current-status").dataset.out = out;
    $("lend").disabled = !board.connected || out;
    $("return").disabled = !board.connected || !out;
    $("books").innerHTML = BOOKS.map(({ id }) => {
        const loans = state.loanCounts[id] ?? 0;
        return `<li>
            <button type="button" class="book${id === state.selected ? " selected" : ""}" data-book="${id}" aria-pressed="${id === state.selected}">
                <span class="letter">${id}</span>
                <span class="title">${escapeHtml(state.titles[id] ?? "")}</span>
                <span class="chip${state.onLoan.has(id) ? " out" : ""}">${state.onLoan.has(id) ? "on loan" : "shelf"}</span>
                <span class="count">${loans} loan${loans === 1 ? "" : "s"}</span>
            </button>
        </li>`;
    }).join("");
}

function log(text, kind = "info", at = Date.now()) {
    const item = document.createElement("li");
    item.className = kind;
    item.innerHTML = `<time>${new Date(at).toLocaleTimeString()}</time><span>${escapeHtml(text)}</span>`;
    $("log").prepend(item);
    while ($("log").children.length > 60) $("log").lastChild.remove();
}

function describeEvent(event) {
    const book = `${event.book} (${state.titles[event.book] ?? "?"})`;
    const via = event.source === "button" ? "button" : event.source === "web" ? "dashboard" : event.source;
    if (event.type === "lend") return event.ok ? `Lent ${book} to ${event.member} · ${via}` : `Refused to lend ${book}: it is on loan · ${via}`;
    return event.ok ? `${book} returned · ${via}` : `Return of ${book} refused: it was not on loan · ${via}`;
}

async function renderManager() {
    const counts = await store.counts();
    $("tabs").innerHTML = store.TABLES.map((table) =>
        `<button type="button" role="tab" data-table="${table}" aria-selected="${table === state.table}">${table} <span class="muted">${counts[table]}</span></button>`
    ).join("");
    const rows = await store.rows(state.table);
    if (rows.length === 0) {
        $("table").innerHTML = `<tbody><tr><td class="empty">No ${state.table} yet. Connect the board, or add sample data.</td></tr></tbody>`;
        return;
    }
    const columns = [...new Set(["id", ...rows.flatMap((row) => Object.keys(row))])];
    const cell = (column, value) => {
        if (TIME_COLUMNS.has(column)) return formatTime(value) || `<span class="muted">—</span>`;
        if (typeof value === "boolean") return value ? "✓" : `<span class="refused">✗</span>`;
        return value == null ? `<span class="muted">—</span>` : escapeHtml(value);
    };
    $("table").innerHTML = `
        <thead><tr>${columns.map((column) => `<th>${column}</th>`).join("")}<th></th></tr></thead>
        <tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${cell(column, row[column])}</td>`).join("")}
            <td><button type="button" class="row-delete" data-key="${escapeHtml(row.id)}" title="Delete this row" aria-label="Delete row ${escapeHtml(row.id)}">×</button></td></tr>`).join("")}
        </tbody>`;
}

async function refresh() {
    const books = await store.db.books.toArray();
    for (const book of books) state.titles[book.id] = book.title;
    state.onLoan = new Set((await store.openLoans()).map((loan) => loan.book));
    state.loanCounts = await store.loanCounts();
    renderShelf();
    await renderManager();
}

// ---------------------------------------------------------------- the board

function setStatus(text, kind) {
    $("status").textContent = text;
    $("status").dataset.state = kind;
}

board.addEventListener("connected", () => {
    state.reconciled = false;
    setStatus("Connected", "on");
    $("connect").textContent = "Disconnect";
    log("Connected; the board restarts and says hello", "board");
    renderShelf();
});

board.addEventListener("disconnected", () => {
    setStatus("Not connected", "off");
    $("connect").textContent = "Connect micro:bit";
    log("Disconnected", "board");
    renderShelf();
});

board.addEventListener("message", async ({ detail: message }) => {
    switch (message.type) {
        case "hello":
            state.member = message.member ?? state.member;
            await store.saveBooks(message.books ?? []);
            log(`Board says hello: ${message.firmware}`, "board");
            break;
        case "state":
            state.selected = message.selected ?? state.selected;
            if (!state.reconciled) {
                state.reconciled = true;
                const { restore, adopted } = await store.reconcile([...(message.onLoan ?? "")], state.member);
                if (restore.length) {
                    await board.send(`SYNC ${restore.join("")}`);
                    log(`Put ${restore.join(", ")} back on loan on the board, from the database`, "board");
                }
                if (adopted.length) log(`Recorded ${adopted.join(", ")} as lent while the dashboard was away`, "board");
            }
            break;
        case "select":
            state.selected = message.book;
            break;
        case "lend":
        case "return":
            await store.recordEvent(message);
            log(describeEvent(message), message.ok ? message.type : "refused");
            break;
        case "error":
            log(`Board: ${message.message}`, "refused");
            break;
    }
    await refresh();
});

$("connect").addEventListener("click", async () => {
    try {
        if (board.connected) {
            await board.disconnect();
        } else {
            setStatus("Connecting…", "busy");
            await board.connect();
        }
    } catch (error) {
        setStatus("Not connected", "off");
        if (error.name !== "NotFoundError") log(`Could not connect: ${error.message}`, "refused");   // NotFoundError: the chooser was cancelled
    }
});

$("lend").addEventListener("click", () => board.send(`LEND ${state.selected}`));
$("return").addEventListener("click", () => board.send(`RETURN ${state.selected}`));
$("books").addEventListener("click", (event) => {
    const button = event.target.closest("[data-book]");
    if (!button) return;
    if (board.connected) {
        board.send(`SELECT ${button.dataset.book}`);
    } else {
        state.selected = button.dataset.book;
        renderShelf();
    }
});

// ---------------------------------------------------------------- the database manager

$("tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-table]");
    if (!tab) return;
    state.table = tab.dataset.table;
    renderManager();
});

$("table").addEventListener("click", async (event) => {
    const button = event.target.closest(".row-delete");
    if (!button) return;
    const key = state.table === "books" ? button.dataset.key : Number(button.dataset.key);
    await store.deleteRow(state.table, key);
    await refresh();
});

$("export").addEventListener("click", async () => {
    const data = await store.exportAll();
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = Object.assign(document.createElement("a"), { href: url, download: `microbit-library-${new Date().toLocaleDateString("sv")}.json` });
    link.click();
    URL.revokeObjectURL(url);
});

$("import").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
        const data = JSON.parse(await file.text());
        if (!confirm(`Replace everything in the database with ${file.name}?`)) return;
        await store.importAll(data);
        log(`Imported ${file.name}`);
    } catch (error) {
        log(`Import failed: ${error.message}`, "refused");
    }
    await refresh();
});

$("sample").addEventListener("click", async () => {
    const books = BOOKS.map(({ id }) => ({ id, title: state.titles[id] }));
    const added = await store.addSampleData(books);
    log(`Added ${added.loans} sample loans and ${added.events} events`);
    await refresh();
});

$("clear").addEventListener("click", async () => {
    if (!confirm("Delete every book, loan and event from this browser's database?")) return;
    await store.clearAll();
    log("Cleared the database");
    await refresh();
});

// ---------------------------------------------------------------- asking Claude

function storage(remember) {
    try { return remember ? localStorage : sessionStorage; } catch { return null; }
}

function loadKey() {
    for (const remember of [true, false]) {
        try {
            const key = storage(remember)?.getItem(KEY_STORAGE);
            if (key) {
                $("api-key").value = key;
                $("remember-key").checked = remember;
                return;
            }
        } catch { /* storage blocked */ }
    }
}

function saveKey() {
    const key = $("api-key").value.trim();
    const remember = $("remember-key").checked;
    try {
        storage(!remember)?.removeItem(KEY_STORAGE);
        if (key) storage(remember)?.setItem(KEY_STORAGE, key);
        else storage(remember)?.removeItem(KEY_STORAGE);
    } catch { /* storage blocked: the key lives in the field only */ }
    $("key-state").textContent = key ? (remember ? "· remembered" : "· for this tab") : "· needed to ask";
}

function renderAnswer(text) {
    // Just enough markdown for short answers: **bold**, `code` and "- " lists.
    const inline = (line) => escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/`([^`]+)`/g, "<code>$1</code>");
    let html = "";
    let list = false;
    for (const line of text.split("\n")) {
        const item = line.match(/^\s*[-*]\s+(.*)/);
        if (item && !list) { html += "<ul>"; list = true; }
        if (!item && list) { html += "</ul>"; list = false; }
        if (item) html += `<li>${inline(item[1])}</li>`;
        else if (line.trim()) html += `<p>${inline(line)}</p>`;
    }
    return html + (list ? "</ul>" : "");
}

$("api-key").addEventListener("change", saveKey);
$("remember-key").addEventListener("change", saveKey);

$("suggestions").innerHTML = SUGGESTIONS.map((text) => `<button type="button" class="suggestion">${escapeHtml(text)}</button>`).join("");
$("suggestions").addEventListener("click", (event) => {
    const button = event.target.closest(".suggestion");
    if (!button) return;
    $("question").value = button.textContent;
    $("ask-form").requestSubmit();
});

$("question").addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        $("ask-form").requestSubmit();
    }
});

$("ask-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = $("question").value.trim();
    const apiKey = $("api-key").value.trim();
    if (!question) return;
    if (!apiKey) {
        $("key-box").open = true;
        $("api-key").focus();
        return;
    }
    $("ask-button").disabled = true;
    $("ask-button").textContent = "Thinking…";
    $("answer").hidden = false;
    $("answer-text").innerHTML = `<p class="muted">Claude is looking through the history…</p>`;
    $("query-list").innerHTML = "";
    $("queries").hidden = true;
    try {
        const { ask } = await import("./ask.js");
        const text = await ask({
            apiKey,
            question,
            titles: state.titles,
            selected: state.selected,
            onQuery: (query) => {
                $("queries").hidden = false;
                $("query-list").insertAdjacentHTML("beforeend", `<li><code>${escapeHtml(query)}</code></li>`);
            },
        });
        $("answer-text").innerHTML = renderAnswer(text);
    } catch (error) {
        $("answer-text").innerHTML = `<p class="refused">${escapeHtml(error.message)}</p>`;
    } finally {
        $("ask-button").disabled = false;
        $("ask-button").textContent = "Ask Claude";
    }
});

// ---------------------------------------------------------------- start

if (!Board.supported) {
    $("unsupported").hidden = false;
    $("connect").disabled = true;
}
loadKey();
saveKey();
for (const event of (await store.db.events.reverse().limit(15).toArray()).reverse()) {
    log(describeEvent(event), event.ok ? event.type : "refused", event.at);
}
await refresh();
