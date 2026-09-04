"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, fetchCabinet, saveCabinetVisibility, type CabinetSummary } from "../../lib/projects/client.ts";

/** The owner's own control over whether `/c/<owner>` opens for anyone. */
export default function ShareCabinetBar() {
  const [cabinet, setCabinet] = useState<CabinetSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    try {
      setCabinet((await fetchCabinet()).cabinet);
    } catch (failure) {
      // A signed-out visitor simply has no cabinet to share; the views say so.
      if (!(failure instanceof ApiError && failure.status === 401)) {
        setError(failure instanceof Error ? failure.message : "Sharing is unavailable.");
      }
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(start);
  }, [load]);

  async function change(next: CabinetSummary["visibility"]) {
    setBusy(true);
    setError("");
    try {
      setCabinet((await saveCabinetVisibility(next)).cabinet);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Sharing could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  if (!cabinet) return null;
  const shared = cabinet.visibility === "public";
  const link = typeof window === "undefined" ? "" : `${window.location.origin}/c/${encodeURIComponent(cabinet.ownerId)}`;

  async function copy() {
    try {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("The link could not be copied. Select it from the address bar instead.");
    }
  }

  return (
    <div className="share-bar">
      <span className="share-state">
        {shared ? "◉ Shared — anyone with the link can view this cabinet" : "◌ Private — only you can see this cabinet"}
      </span>
      <div className="share-actions">
        {shared && <button type="button" onClick={() => void copy()}>{copied ? "Link copied" : "Copy link"}</button>}
        <button type="button" className="share-toggle" disabled={busy} onClick={() => void change(shared ? "private" : "public")}>
          {busy ? "Saving…" : shared ? "Make private" : "Share with a link"}
        </button>
      </div>
      {error && <span className="share-error" role="alert">{error}</span>}
    </div>
  );
}
