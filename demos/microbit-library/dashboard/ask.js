// Questions about the lending history, answered by Claude. Claude cannot see the database; it
// gets three read-only tools that run Dexie queries here in the browser, and answers from what
// they return. The API key is the viewer's own and goes from this page straight to Anthropic.
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.128.0";
import { betaTool } from "https://esm.sh/@anthropic-ai/sdk@0.128.0/helpers/beta/json-schema";

import { eventRow, findEvents, findLoans, groupLoans, loanRow } from "./db.js";

const MODEL = "claude-haiku-5-5";

const SYSTEM = `You answer questions about a small library that runs on a BBC micro:bit.
Five books, A to E, can be lent to members and returned. The browser keeps the history in
IndexedDB, which you can read only through the tools:

- loan_stats: loans counted per book, member, day, weekday or hour, with how long books were kept.
- list_loans: individual loans (lentAt, returnedAt, minutesKept; returnedAt is null while out).
- list_events: every lend or return attempt reported by the board, including refused ones
  (ok=false: lending a book that is already out, or returning one that is not).

"How often is a book loaned" means the number of loans. Times are ISO 8601; convert them to the
viewer's time zone (given with each question) when you mention them. Base every number on a tool
result, never guess. If the data cannot answer the question, say so. Answer in a few plain
sentences or a short list, without headings.`;

const BOOK = { type: "string", enum: ["A", "B", "C", "D", "E"], description: "A book's letter. Leave out for all books." };
const FROM = { type: "string", description: "ISO 8601 date-time; only things at or after this moment. Leave out for no lower bound." };
const TO = { type: "string", description: "ISO 8601 date-time; only things before this moment. Leave out for no upper bound." };

function time(text) {
    if (text == null) return undefined;
    const ms = Date.parse(text);
    if (Number.isNaN(ms)) throw new Error(`Not a date-time: ${text}`);
    return ms;
}

function book(letter) {
    if (letter == null) return undefined;
    if (!/^[A-E]$/.test(letter)) throw new Error(`Not a book: ${letter}`);
    return letter;
}

function makeTools(titles, onQuery) {
    return [
        betaTool({
            name: "loan_stats",
            description: "Count loans grouped by book, member, day (YYYY-MM-DD), weekday or hour of the day, optionally for one book and a period of lending. Each group has loans, open, returned and averageMinutesKept (over returned loans). Groups are sorted by most loans first.",
            inputSchema: {
                type: "object",
                properties: {
                    group_by: { type: "string", enum: ["book", "member", "day", "weekday", "hour"] },
                    book: BOOK,
                    from: FROM,
                    to: TO,
                },
                required: ["group_by"],
                additionalProperties: false,
            },
            run: async (input) => {
                const { loans, query } = await findLoans({ book: book(input.book), from: time(input.from), to: time(input.to) });
                onQuery(`${query}  → grouped by ${input.group_by}`);
                const groups = groupLoans(loans, input.group_by);
                if (input.group_by === "book") groups.forEach((group) => { group.title = titles[group.key] ?? null; });
                return JSON.stringify({ totalLoans: loans.length, groups });
            },
        }),
        betaTool({
            name: "list_loans",
            description: "List individual loans, newest first, optionally for one book, a status and a period of lending. Returns the total number that match and at most `limit` rows.",
            inputSchema: {
                type: "object",
                properties: {
                    book: BOOK,
                    status: { type: "string", enum: ["open", "returned", "any"], description: "open: still out; returned: back. Default any." },
                    from: FROM,
                    to: TO,
                    limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
                },
                additionalProperties: false,
            },
            run: async (input) => {
                const { loans, query } = await findLoans({
                    book: book(input.book), status: input.status ?? "any", from: time(input.from), to: time(input.to),
                });
                onQuery(query);
                loans.sort((a, b) => b.lentAt - a.lentAt);
                const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
                return JSON.stringify({ total: loans.length, loans: loans.slice(0, limit).map((loan) => loanRow(loan, titles)) });
            },
        }),
        betaTool({
            name: "list_events",
            description: "List lend and return attempts as the board reported them, newest first, including refused ones (ok=false). Returns the total number that match and at most `limit` rows.",
            inputSchema: {
                type: "object",
                properties: {
                    type: { type: "string", enum: ["lend", "return"] },
                    book: BOOK,
                    ok: { type: "boolean", description: "true: the library agreed; false: it refused." },
                    from: FROM,
                    to: TO,
                    limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 50." },
                },
                additionalProperties: false,
            },
            run: async (input) => {
                const { events, query } = await findEvents({
                    type: input.type, book: book(input.book), ok: input.ok, from: time(input.from), to: time(input.to),
                });
                onQuery(query);
                events.sort((a, b) => b.at - a.at);
                const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);
                return JSON.stringify({ total: events.length, events: events.slice(0, limit).map(eventRow) });
            },
        }),
    ];
}

// Asks one question; resolves to the answer's text. onQuery(text) is called with each Dexie
// query a tool runs, so the page can show it.
export async function ask({ apiKey, question, titles, selected, onQuery }) {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const shelf = Object.entries(titles).map(([id, title]) => `${id} = ${title}`).join(", ");
    const context = [
        `Now: ${new Date().toISOString()} (viewer's time zone: ${zone}).`,
        `Books: ${shelf || "not announced yet"}.`,
        `The selected book, shown on the board, is ${selected}${titles[selected] ? ` (${titles[selected]})` : ""}; "this book" means that one.`,
    ].join("\n");

    let message;
    try {
        message = await client.beta.messages.toolRunner({
            model: MODEL,
            max_tokens: 16000,
            output_config: { effort: "medium" },
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: SYSTEM,
            tools: makeTools(titles, onQuery),
            max_iterations: 8,
            messages: [{ role: "user", content: `${context}\n\nQuestion: ${question}` }],
        });
    } catch (error) {
        if (error instanceof Anthropic.AuthenticationError) throw new Error("Anthropic did not accept this API key.");
        if (error instanceof Anthropic.PermissionDeniedError) throw new Error("This API key may not use this model.");
        if (error instanceof Anthropic.RateLimitError) throw new Error("Too many requests for this API key; try again in a minute.");
        if (error instanceof Anthropic.APIConnectionError) throw new Error("Could not reach api.anthropic.com; check the network.");
        if (error instanceof Anthropic.APIError) throw new Error(`The Claude API said: ${error.message}`);
        throw error;
    }
    if (message.stop_reason === "refusal") {
        throw new Error("Claude declined to answer this question.");
    }
    const text = message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n").trim();
    return text || "(no answer)";
}
