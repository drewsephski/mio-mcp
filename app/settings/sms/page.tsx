import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Smartphone } from "lucide-react";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { getResourceIds } from "@/lib/config";
import { getSmsStatus } from "@/lib/sms";
import { Brand } from "@/app/components/brand";
import { SmsSettings } from "./sms-settings";

export const metadata: Metadata = { title: "SMS Assistant", robots: { index: false, follow: false } };

export default async function SmsPage() {
  const user = await getAppwriteHelpers().getLoggedInUser();
  if (!user) redirect("/auth");
  const status = await getSmsStatus().catch(() => null);
  return <main className="sms-settings-shell"><header><Brand /><Link href="/dashboard" className="text-link"><ArrowLeft size={14} aria-hidden="true" />Back to notes</Link></header><section className="sms-settings-card"><div className="sms-settings-icon"><Smartphone aria-hidden="true" /></div><h1>Your assistant has a phone number.</h1><p className="muted">Text Mio to remember something, find a thought, or get a reminder. Keep the conversation going.</p>{status ? <SmsSettings initialStatus={status} ownerId={user.$id} databaseId={getResourceIds().databaseId} /> : <p className="notice notice-error" role="alert">SMS settings are temporarily unavailable. Your web notes are still available. Reload this page in a moment.</p>}</section></main>;
}
