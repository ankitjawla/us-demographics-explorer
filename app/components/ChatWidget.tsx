"use client";

import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { HBar, Donut, CHART_COLORS } from "./Charts";

/* ---------- types (mirror app/api/chat/route.ts extras) ---------- */

interface ChatChartBar { label: string; title?: string; value: number; display: string }
interface ChatChartPair {
  label: string;
  previous: number | null;
  current: number | null;
  previousDisplay: string;
  currentDisplay: string;
}
interface ChatChart {
  type: "bar" | "trend" | "donut";
  title: string;
  subtitle?: string;
  bars?: ChatChartBar[];
  pairs?: ChatChartPair[];
  slices?: Array<{ label: string; value: number; pct: number | null }>;
}
interface ChatPlace {
  geo_id: string;
  name: string;
  geo_type: string;
  state_fips: string;
  state_name: string;
}
interface Msg {
  role: "user" | "assistant";
  content: string;
  chart?: ChatChart | null;
  suggestions?: string[];
  place?: ChatPlace | null;
}

const STORE_KEY = "usdec-chat-v1";
const SUGGEST_RE = /\[\[SUGGEST:\s*[\s\S]*?\]\]\s*$/;

const STARTERS = [
  "Which NJ county has the highest median household income?",
  "Tell me about Teaneck township, NJ",
  "How has Paramus borough, NJ changed since the last ACS release?",
  "Rank states by median household income",
];

/* ---------- icons ---------- */

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
  trash: "M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M10 11v6M14 11v6",
  pin: "M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
};
function StopIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <rect x="6" y="6" width="12" height="12" rx="2.5" />
    </svg>
  );
}

/* ---------- markdown (dashboard aesthetic) ---------- */

const mdComponents = {
  p: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <p className="my-1.5 leading-relaxed first:mt-0 last:mb-0" {...(props as object)} />
  ),
  strong: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <strong className="font-bold text-stone-900" {...(props as object)} />
  ),
  ul: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <ul className="my-1.5 list-disc space-y-1 pl-5" {...(props as object)} />
  ),
  ol: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <ol className="my-1.5 list-decimal space-y-1 pl-5" {...(props as object)} />
  ),
  li: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <li className="leading-relaxed" {...(props as object)} />
  ),
  table: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <div className="my-2 overflow-x-auto rounded-lg border border-stone-200">
      <table className="w-full border-collapse text-[13px]" {...(props as object)} />
    </div>
  ),
  thead: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <thead className="bg-stone-100" {...(props as object)} />
  ),
  th: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <th className="border-b border-stone-200 px-2.5 py-1.5 text-left text-xs font-bold text-stone-700" {...(props as object)} />
  ),
  td: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <td className="border-b border-stone-100 px-2.5 py-1.5 tabular-nums text-stone-700 last:border-b-0" {...(props as object)} />
  ),
  code: ({ node, ...props }: { node?: unknown; [k: string]: unknown }) => (
    <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-[12.5px] text-stone-800" {...(props as object)} />
  ),
};

function Markdown({ text }: { text: string }) {
  return (
    <div className="text-sm text-stone-800">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents as never}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

/* ---------- inline chart (reuses dashboard chart styling) ---------- */

function TrendPairs({ pairs }: { pairs: ChatChartPair[] }) {
  const max = Math.max(1, ...pairs.flatMap((p) => [p.previous ?? 0, p.current ?? 0]));
  return (
    <div className="space-y-3">
      {pairs.map((p) => (
        <div key={p.label}>
          <div className="mb-1 text-xs font-semibold text-stone-700">{p.label}</div>
          {[
            { label: "2019–2023", value: p.previous, display: p.previousDisplay, color: "#a8a29e" },
            { label: "2020–2024", value: p.current, display: p.currentDisplay, color: "#2563eb" },
          ].map((r) =>
            r.value == null ? null : (
              <div key={r.label} className="mb-1 flex items-center gap-2 last:mb-0">
                <span className="w-[68px] shrink-0 text-[11px] text-stone-500">{r.label}</span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-stone-200/70">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.max(0, Math.min(100, (r.value / max) * 100))}%`, background: r.color }}
                  />
                </div>
                <span className="w-[84px] shrink-0 text-right text-[11px] font-semibold tabular-nums text-stone-800">
                  {r.display}
                </span>
              </div>
            )
          )}
        </div>
      ))}
    </div>
  );
}

function ChatChartView({ chart }: { chart: ChatChart }) {
  return (
    <div className="mt-2.5 rounded-xl border border-stone-200/70 bg-stone-50/70 p-3">
      <div className="text-xs font-extrabold tracking-tight text-stone-900">{chart.title}</div>
      {chart.subtitle && <div className="mb-2 mt-0.5 text-[11px] text-stone-500">{chart.subtitle}</div>}
      {chart.type === "bar" && chart.bars && (
        <HBar
          ariaLabel={chart.title}
          barHeight="h-2"
          items={chart.bars.map((b) => ({
            label: b.label,
            value: b.value,
            display: b.display,
            color: "#2563eb",
            title: b.title || b.label,
          }))}
        />
      )}
      {chart.type === "trend" && chart.pairs && <TrendPairs pairs={chart.pairs} />}
      {chart.type === "donut" && chart.slices && (
        <>
          <Donut
            ariaLabel={chart.title}
            centerTop={chart.slices[0] ? `${chart.slices[0].pct ?? ""}%` : ""}
            centerBottom={chart.slices[0]?.label || ""}
            slices={chart.slices.map((s, i) => ({
              label: s.label,
              value: s.value,
              pct: s.pct,
              color: CHART_COLORS[i % CHART_COLORS.length],
            }))}
          />
          <div className="mt-2 space-y-1">
            {chart.slices.map((s, i) => (
              <div key={s.label} className="flex items-center gap-2 text-xs text-stone-600">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}
                />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="font-semibold tabular-nums text-stone-800">
                  {s.pct != null ? `${s.pct}%` : ""}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- typing indicator ---------- */

function TypingDots() {
  return (
    <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-sm" aria-label="Assistant is thinking">
      {[0, 1, 2].map((d) => (
        <span
          key={d}
          className="h-2 w-2 animate-bounce rounded-full bg-blue-500"
          style={{ animationDelay: `${d * 160}ms` }}
        />
      ))}
      <span className="ml-1 text-[11px] text-stone-400">checking census data…</span>
    </div>
  );
}

/* ---------- widget ---------- */

function loadStored(): Msg[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
      .slice(-50);
  } catch {
    return [];
  }
}

export default function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>(loadStored);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-50)));
    } catch {
      /* storage unavailable */
    }
  }, [msgs]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs, streaming, waiting, open]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 80);
  }, [open ]);

  function updateMsg(idx: number, patch: Partial<Msg> | ((m: Msg) => Msg)) {
    setMsgs((prev) =>
      prev.map((m, i) => (i === idx ? (typeof patch === "function" ? (patch as (m: Msg) => Msg)(m) : { ...m, ...patch }) : m))
    );
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearChat() {
    stop();
    setMsgs([]);
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* ignore */
    }
  }

  function viewInDashboard(place: ChatPlace) {
    window.dispatchEvent(new CustomEvent("chat:select-place", { detail: place }));
    setOpen(false);
  }

  async function send(text: string) {
    const q = text.trim();
    if (!q || streaming) return;
    const payload = [...msgs, { role: "user" as const, content: q }].map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(next);
    setInput("");
    setStreaming(true);
    setWaiting(true);

    const ctl = new AbortController();
    abortRef.current = ctl;
    const aIdx = next.length; // assistant message lands here
    setMsgs((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: payload, stream: true }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      let gotToken = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split("\n\n");
        buf = parts.pop() || "";
        for (const part of parts) {
          const line = part.split("\n").map((l) => l.trim()).find((l) => l.startsWith("data:"));
          if (!line) continue;
          let evt: { token?: string; done?: boolean; error?: string; reply?: string; chart?: ChatChart | null; suggestions?: string[]; place?: ChatPlace | null };
          try {
            evt = JSON.parse(line.slice(5).trim());
          } catch {
            continue;
          }
          if (evt.token) {
            if (!gotToken) {
              gotToken = true;
              setWaiting(false);
            }
            const t = evt.token;
            updateMsg(aIdx, (m) => ({ ...m, content: m.content + t }));
          } else if (evt.done) {
            updateMsg(aIdx, (m) => ({
              ...m,
              content: (evt.reply ?? m.content).trim() || m.content,
              chart: evt.chart ?? null,
              suggestions: evt.suggestions ?? [],
              place: evt.place ?? null,
            }));
          } else if (evt.error) {
            updateMsg(aIdx, { content: evt.error });
          }
        }
      }
      // If the stream closed without a done event and nothing arrived, say so.
      updateMsg(aIdx, (m) =>
        !m.content.trim() && !m.chart ? { ...m, content: "Hmm, I didn't get a response. Try again?" } : m
      );
    } catch (e) {
      if ((e as Error).name === "AbortError") {
        updateMsg(aIdx, (m) =>
          m.content.trim() ? m : { ...m, content: "Stopped." }
        );
      } else {
        updateMsg(aIdx, { content: "Hmm, something went wrong sending that. Try again?" });
      }
    } finally {
      setStreaming(false);
      setWaiting(false);
      abortRef.current = null;
    }
  }

  const lastAssistantIdx = (() => {
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === "assistant") return i;
    return -1;
  })();

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
          sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[580px] sm:w-[400px] sm:rounded-2xl">
          {/* header */}
          <div className="flex items-center gap-3 border-b border-stone-200/70 bg-stone-900 px-4 py-3.5 text-white">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10">
              <Icon d={I.chat} className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-extrabold tracking-tight">Data assistant</div>
              <div className="truncate text-[11px] text-stone-300">Ask about U.S. demographics</div>
            </div>
            {msgs.length > 0 && (
              <button
                onClick={clearChat}
                aria-label="Clear chat history"
                title="Clear chat history"
                className="rounded-lg p-1.5 text-stone-300 hover:bg-white/10 hover:text-white"
              >
                <Icon d={I.trash} className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={() => { stop(); setOpen(false); }}
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
                  <p className="font-semibold text-stone-900">Hi! I'm your census data assistant.</p>
                  <p className="mt-1">
                    Ask me anything about U.S. demographics — populations, incomes, poverty, rankings, trends —
                    for states, counties, townships, boroughs, even census tracts. I answer with charts and can
                    drop any place straight into the dashboard.
                  </p>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="rounded-xl border border-stone-200 bg-white px-3.5 py-2.5 text-left text-[13px] font-medium text-stone-600 shadow-sm transition hover:border-blue-400 hover:text-blue-700"
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
                  className={`max-w-[88%] rounded-2xl px-4 py-2.5 shadow-sm ${
                    m.role === "user"
                      ? "rounded-br-md bg-blue-600 text-white"
                      : "rounded-tl-md bg-white text-stone-800"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <>
                      {m.content.replace(SUGGEST_RE, "").trim() ? (
                        <Markdown text={m.content.replace(SUGGEST_RE, "").trim()} />
                      ) : streaming && i === msgs.length - 1 ? null : null}
                      {m.chart && <ChatChartView chart={m.chart} />}
                      {m.place && !streaming && (
                        <button
                          onClick={() => viewInDashboard(m.place as ChatPlace)}
                          className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                        >
                          <Icon d={I.pin} className="h-3.5 w-3.5" />
                          View {(m.place as ChatPlace).name} in dashboard
                        </button>
                      )}
                      {i === lastAssistantIdx && !streaming && m.suggestions && m.suggestions.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-stone-100 pt-2.5">
                          {m.suggestions.map((s) => (
                            <button
                              key={s}
                              onClick={() => send(s)}
                              className="rounded-full border border-stone-200 bg-stone-50 px-2.5 py-1 text-left text-[11.5px] font-medium text-stone-600 transition hover:border-blue-400 hover:text-blue-700"
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap break-words text-sm">{m.content}</span>
                  )}
                </div>
              </div>
            ))}
            {waiting && (
              <div className="flex justify-start">
                <TypingDots />
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
            {streaming ? (
              <button
                type="button"
                onClick={stop}
                aria-label="Stop generating"
                title="Stop generating"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-900 text-white transition hover:bg-stone-700"
              >
                <StopIcon />
              </button>
            ) : (
              <button
                type="submit"
                disabled={!input.trim()}
                aria-label="Send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-stone-900 text-white transition hover:bg-stone-700 disabled:opacity-40"
              >
                <Icon d={I.send} className="h-4 w-4" />
              </button>
            )}
          </form>
        </div>
      )}
    </>
  );
}
