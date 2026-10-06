"use client";
import { useEffect, useState, useTransition } from "react";
import { DotsRing } from "@/app/components/ui/dots-ring";
import { useRouter } from "next/navigation";
import { useAppwrite } from "@appwrite.io/react";
import { Channel } from "appwrite";

export function ProductLiveRefresh({ ownerId, databaseId, section }: { ownerId: string; databaseId: string; section: string }) {
  const router = useRouter();
  const { realtime } = useAppwrite();
  const [status, setStatus] = useState("");
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unsubscribe: (() => void) | undefined;
    const tables = section === "today" ? ["reminders", "notes", "sms_conversations"] : section === "activity" ? ["sms_turns"] : section === "reminders" ? ["reminders"] : ["sms_conversations", "sms_connections"];
    function refresh() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (disposed) return;
        if (document.querySelector('[data-companion-editing="true"]')) {
          setStatus("Mio changed while you were editing. Finish your change, then refresh to see the latest view.");
          return;
        }
        setStatus("");
        startTransition(() => router.refresh());
      }, 250);
    }
    realtime.subscribe(tables.map((table) => Channel.tablesdb(databaseId).table(table).row()), (event) => {
      if ((event.payload as { ownerId?: string }).ownerId === ownerId) refresh();
    }).then((subscription) => {
      if (disposed) subscription.unsubscribe();
      else unsubscribe = () => { subscription.unsubscribe(); };
    }).catch(() => { if (!disposed) setStatus("Live updates are paused. Use Refresh to check the latest view."); });
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => { disposed = true; clearTimeout(timer); unsubscribe?.(); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); };
  }, [databaseId, ownerId, realtime, router, section, startTransition]);
  return status || pending ? <p className="notice product-live-status" role="status">{pending ? <span className="loading-inline"><DotsRing aria-hidden="true" />Updating your view…</span> : status}</p> : null;
}
