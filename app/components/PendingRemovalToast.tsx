"use client";

import { useEffect, useState } from "react";

export default function PendingRemovalToast({ quantity, name, deadline, onUndo }: { quantity: number; name: string; deadline: number; onUndo: () => void }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    const interval = window.setInterval(update, 250);
    return () => window.clearInterval(interval);
  }, [deadline]);
  return <div className="removal-toast" role="status" aria-live="polite">
    <span>Removing {quantity} × {name} in {seconds}s</span>
    <button type="button" onClick={onUndo}>Undo</button>
  </div>;
}
