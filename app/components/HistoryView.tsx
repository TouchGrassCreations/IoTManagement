"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchHistory } from "../../lib/history/client.ts";
import { describeHistoryEvent, historyDate } from "../../lib/history/format.ts";
import type { HistoryEvent } from "../../lib/history/types.ts";
import { ApiError } from "../../lib/inventory/client.ts";

const KIND_LABELS: Record<HistoryEvent["kind"], string> = {
  scan: "SCAN",
  identification: "CATALOGUED",
  adjustment: "STOCK",
};

function dayLabel(event: HistoryEvent): string {
  return historyDate(event.at).toLocaleDateString(undefined, { dateStyle: "full" });
}

function timeLabel(event: HistoryEvent): string {
  return historyDate(event.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function HistoryView({ refreshToken }: { refreshToken: number }) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [signInRequired, setSignInRequired] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  function reportError(failure: unknown, fallback: string) {
    if (failure instanceof ApiError && failure.status === 401) {
      setSignInRequired(true);
      setError("");
      return;
    }
    setError(failure instanceof Error ? failure.message : fallback);
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const page = await fetchHistory();
      setEvents(page.events);
      setNextCursor(page.nextCursor);
      setError("");
      setSignInRequired(false);
    } catch (failure) {
      reportError(failure, "History could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred a tick so the fetch's first setState lands outside the effect body.
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
  }, [load, refreshToken]);

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchHistory(nextCursor);
      setEvents((current) => {
        const known = new Set(current.map((event) => event.id));
        return [...current, ...page.events.filter((event) => !known.has(event.id))];
      });
      setNextCursor(page.nextCursor);
    } catch (failure) {
      reportError(failure, "The next page could not be loaded.");
    } finally {
      setLoadingMore(false);
    }
  }

  const days = useMemo(() => {
    const grouped: { day: string; events: HistoryEvent[] }[] = [];
    for (const event of events) {
      const day = dayLabel(event);
      const last = grouped[grouped.length - 1];
      if (last && last.day === day) last.events.push(event);
      else grouped.push({ day, events: [event] });
    }
    return grouped;
  }, [events]);

  if (signInRequired) {
    return (
      <section className="sign-in-gate">
        <p className="eyebrow">YOUR CABINET IS PRIVATE</p>
        <h1>Sign in to open it.</h1>
        <p>History belongs to the person who catalogued the parts. Sign in to see yours.</p>
        <a className="hero-camera-button" href="/signin-with-chatgpt?return_to=%2F">Sign in with ChatGPT</a>
      </section>
    );
  }

  return (
    <section className="history-view">
      <div className="history-intro">
        <div>
          <p className="eyebrow">CABINET HISTORY</p>
          <h1>Everything that<br /><em>happened here.</em></h1>
        </div>
        <p>Every scan, every part filed and every change of stock, newest first.</p>
      </div>

      {error && <p className="inventory-message error" role="alert">{error} <button type="button" onClick={() => void load()}>Retry</button></p>}
      {loading && <p className="inventory-message" role="status">Loading history…</p>}

      {days.map((group) => (
        <section className="history-day" key={group.day}>
          <h2>{group.day}</h2>
          <ol>
            {group.events.map((event) => (
              <li className={`history-event ${event.kind}`} key={event.id}>
                <span className="history-kind">{KIND_LABELS[event.kind]}</span>
                <p>{describeHistoryEvent(event)}</p>
                <time dateTime={historyDate(event.at).toISOString()}>{timeLabel(event)}</time>
              </li>
            ))}
          </ol>
        </section>
      ))}

      {events.length === 0 && !loading && !error && (
        <div className="empty">
          <strong>Nothing has happened yet</strong>
          <p>Scans, confirmations and stock changes show up here as soon as you catalogue your first part.</p>
        </div>
      )}

      {nextCursor && (
        <button type="button" className="load-more" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? "Loading…" : "Load older events"}
        </button>
      )}
    </section>
  );
}
