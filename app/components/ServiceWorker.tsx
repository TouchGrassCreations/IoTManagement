"use client";

import { useEffect } from "react";

/**
 * Registers the offline shell. Best effort by design: a browser without service
 * workers, or a page served over plain HTTP, must keep working exactly as it
 * did before rather than surfacing an error nobody can act on.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const register = () => void navigator.serviceWorker.register("/sw.js").catch(() => {});

    if (document.readyState === "complete") {
      // Registration competes with the first inventory fetch, so it waits a tick.
      const start = window.setTimeout(register, 0);
      return () => window.clearTimeout(start);
    }
    window.addEventListener("load", register);
    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
