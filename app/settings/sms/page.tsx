import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Smartphone } from "lucide-react";
import { requireBetaPage } from "@/lib/beta-page";
import { getResourceIds } from "@/lib/config";
import { getSmsStatus } from "@/lib/sms";
import { ProductShell } from "@/app/components/product-shell";
import { SmsSettings } from "./sms-settings";

export const metadata: Metadata = { title: "Phone connection", robots: { index: false, follow: false } };

export default async function SmsPage() {
  const user = await requireBetaPage();
  const status = await getSmsStatus().catch(() => null);
  return <ProductShell active="settings" title="Phone connection" description="Manage the number you use to text Mio." user={user} actions={<Link href="/settings" className="button button-quiet"><ArrowLeft size={14} aria-hidden="true" />Back to settings</Link>}><section className="sms-settings-card"><div className="sms-settings-icon"><Smartphone aria-hidden="true" /></div><h2>{status?.connected ? "Your phone is connected." : "Connect your phone."}</h2><p className="muted">Connect your number to save thoughts and request reminders over text.</p>{status ? <SmsSettings initialStatus={status} ownerId={user.$id} databaseId={getResourceIds().databaseId} /> : <p className="notice notice-error" role="alert">SMS settings are temporarily unavailable. Your web notes are still available. Reload this page in a moment.</p>}</section></ProductShell>;
}
