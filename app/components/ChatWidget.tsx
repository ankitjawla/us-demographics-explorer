"use client";

import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const STARTERS = [
  "Which NJ county has the highest median income?",
  "Tell me about Teaneck township, NJ",
  "Where is poverty rising fastest?",
];

function Icon({ d, className = "h-5 w-5" }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={d} />
    </svg>
  );
}
const I = {
  chat: "M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z",
  x: "M18 6L6 18M6 6l12 12",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
};

/** Minimal rich-text: paragraphs, line breaks, **bold**. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => (
        <p key={i} className="whitespace-pre-wrap break-words leading-relaxed">
          {b.split(/(\*\*[^*]+\*\*)/g).map((part, j) =>
            part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
              <strong key={j} className="font-bold">{part.slice(2, -2)}</strong>
            ) : (
              <span key={j}>{part}</span>
            )
          )}
        </p>
      ))}
    </div>
  );
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, busy, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open ]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next = [...msgs, { role: "user" as const, content: q }];
    setMsgs(next);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const j = await res.json();
      setMsgs((m) => [...m, { role: "assistant", content: j.reply || "Sorry — I didn't catch that." }]);
    } catch {
      setMsgs((m) => [...m, { role: "assistant", content: "Hmm, something went wrong sending that. Try again?" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open data assistant"
          className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-stone-900 text-white shadow-xl transition-transform hover:scale-105 active:scale-95"
        >
          <Icon d={I.chat} className="h-6 w-6" />
        </button>
      )}

      {/* panel */}
      {open && (
        <div className="fixed z-50 flex flex-col overflow-hidden border border-stone-200/80 bg-white shadow-2xl
          inset-x-3 bottom-3 top-auto h-[72vh] rounded-3xl
          sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[560px] sm:w-[380px] sm:rounded-2xl">
          {/* header */}
          <div className="flex items-center gap-3 border-b border-stone-200/70 bg-stone-900 px-4 py-3.5 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
              <Icon d={I.chat} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold tracking-tight">Data assistant</div>
              <div className="truncate text-[11px] text-stone-300">Ask about U.S. demographics</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              className="rounded-lg p-1.5 text-stone-300 hover:bg-white/10 hover:text-white"
            >
              <Icon d={I.x} className="h-5 w-5" />
            </button>
          </div>

          {/* messages */}
          <div ref={scrollRef} className="nice-scroll flex-1 space-y-3 overflow-y-auto bg-[#f6f6f4] px-4 py-4">
            {msgs.length === 0 && (
              <div>
                <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm leading-relaxed text-stone-700 shadow-sm">
                  Hi! I can answer questions using the app's census data — populations, incomes, rankings, trends, townships, all of it. What's on your mind?
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-full border border-stone-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-stone-600 shadow-sm hover:border-blue-400 hover:text-blue-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm ${
                    m.role === "user"
                      ? "rounded-br-md bg-blue-600 text-white"
                      : "rounded-tl-md bg-white text-stone-800"
                  }`}
                >
                  {m.role === "assistant" ? <RichText text={m.content} /> : <span className="whitespace-pre-wrap break-words">{m.content}</span>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-sm">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="h-2 w-2 animate-bounce rounded-full bg-stone-400"
                      style={{ animationDelay: `${d * 150}ms` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-stone-200/70 bg-white px-3 py-3"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about demographics…"
              className="min-w-0 flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3.5 py-2.5 text-sm outline-none placeholder:text-stone-400 focus:border-blue-500 focus:bg-white"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-900 text-white transition hover:bg-stone-700 disabled:opacity-40"
            >
              <Icon d={I.send} className="h-4 w-4" />
            </button>
          </form>
        </div>
      )}
    </>
  );
}
