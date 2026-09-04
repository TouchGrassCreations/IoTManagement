import Link from "next/link";
import { headers } from "next/headers";
import SharedCabinetView from "../../components/SharedCabinetView";
import { resolveOwnerLabel } from "../../../lib/auth/owner.ts";
import { getCabinet } from "../../../lib/cabinet/persistence.ts";
import { accessFor } from "../../../lib/cabinet/types.ts";
import type { D1Like } from "../../../lib/identification/persistence.ts";

export const dynamic = "force-dynamic";

async function database(): Promise<D1Like> {
  const { env } = await import("cloudflare:workers");
  return (env as unknown as { DB: D1Like }).DB;
}

export default async function SharedCabinetPage({ params }: { params: Promise<{ owner: string }> | { owner: string } }) {
  const { owner } = await params;
  const ownerId = decodeURIComponent(owner);
  const requestHeaders = await headers();
  const viewerId = requestHeaders.get("oai-authenticated-user-id")?.trim() || null;
  const cabinet = await getCabinet(ownerId, await database());

  if (!accessFor(cabinet, viewerId).canView) {
    return (
      <main className="app-shell">
        <header className="topbar">
          <span className="brand">
            <span className="brand-mark"><i /><i /><i /></span>
            <span>Parts Cabinet</span>
          </span>
        </header>
        <section className="hero camera-hero signin-hero">
          <div>
            <p className="eyebrow">CABINET NOT SHARED</p>
            <h1>Nothing to see here.<br /><em>Yet.</em></h1>
            <p className="hero-copy">This cabinet is private, or the link is wrong. If it is yours, open it from the home page.</p>
            <div className="hero-actions"><Link className="hero-camera-button" href="/">Open your cabinet</Link></div>
          </div>
        </section>
      </main>
    );
  }

  return <SharedCabinetView ownerId={ownerId} label={cabinet?.label ?? resolveOwnerLabel(requestHeaders)} />;
}
