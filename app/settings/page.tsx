import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppwriteHelpers } from "@/lib/appwrite";
import { getPreferences, getUsage } from "@/lib/companion";
import { getSmsStatus } from "@/lib/sms";
import { ProductShell } from "@/app/components/product-shell";
import { RefreshButton } from "@/app/today/refresh-button";
import { PreferencesForm } from "./preferences-form";

export const metadata: Metadata = { title: "Settings", robots: { index: false, follow: false } };

export default async function SettingsPage() {
  const user = await getAppwriteHelpers().getLoggedInUser();
  if (!user) redirect("/auth");
  if (!user.emailVerification) redirect("/onboarding");
  const [preferences, status, usage] = await Promise.all([getPreferences().catch(() => null), getSmsStatus().catch(() => null), getUsage().catch(() => null)]);
  return <ProductShell active="settings" title="Settings" description="Make Mio fit your day." user={user} actions={<RefreshButton />}>
    <section className="product-section"><div className="product-section-heading"><h2>Your phone</h2></div>{status ? <div className="product-setting-row"><div><strong>{status.connected ? `Connected · ${status.phone}` : "Connect your phone to Mio"}</strong><p className="muted">{status.connected ? `Text Mio at ${status.mioPhone}.${preferences ? ` SMS is ${preferences.smsEnabled ? "enabled" : "disabled"}.` : ""}` : "Your phone number verifies your private conversation."}</p></div><Link href={status.connected ? "/settings/sms" : "/onboarding"} className="button button-secondary">{status.connected ? "Manage connection" : "Connect phone"}</Link></div> : <p className="notice notice-error" role="alert">Phone status couldn’t load. Refresh to check your connection.</p>}</section>
    <section className="product-section"><div className="product-section-heading"><h2>Reminders and time</h2></div>{preferences ? <PreferencesForm key={`${preferences.timezone}:${preferences.defaultOffsetMinutes}:${preferences.quietHoursStart}:${preferences.quietHoursEnd}`} preferences={preferences} /> : <p className="notice notice-error" role="alert">Preferences couldn’t load. Refresh before making changes.</p>}</section>
    <section className="product-section"><div className="product-section-heading"><h2>Beta usage</h2></div>{usage ? <div className="product-usage"><p className="product-hint">{usage.date} · Daily limits reset at midnight UTC. Counts include reserved attempts and messages, including work in progress.</p><div className="product-usage-row"><label htmlFor="ai-usage">Assistant turns <strong>{usage.aiTurns} / {usage.limits.aiPerDay}</strong></label><progress id="ai-usage" max={usage.limits.aiPerDay} value={Math.min(usage.aiTurns, usage.limits.aiPerDay)} /></div><div className="product-usage-row"><label htmlFor="sms-usage">Outbound SMS <strong>{usage.outboundSms} / {usage.limits.outboundPerDay}</strong></label><progress id="sms-usage" max={usage.limits.outboundPerDay} value={Math.min(usage.outboundSms, usage.limits.outboundPerDay)} /></div><p className="product-hint">Up to {usage.limits.inboundPerMinute} inbound texts per minute, {usage.limits.aiPerHour} assistant turns per hour, and {usage.limits.maxActiveReminders} active reminders.</p>{(usage.globalLimited.ai || usage.globalLimited.sms) && <p className="notice" role="status">{usage.globalLimited.ai ? "New assistant replies are temporarily paused by the beta’s service limit. " : ""}{usage.globalLimited.sms ? "SMS capacity is temporarily limited across the beta." : ""}</p>}</div> : <p className="notice notice-error" role="alert">Usage couldn’t load. Refresh to check your current limits.</p>}</section>
    <section className="product-section"><div className="product-section-heading"><h2>Your account</h2></div><div className="product-setting-row"><div><strong>{user.name || "Mio account"}</strong><p className="muted">{user.email}</p></div><Link href="/auth" className="button button-secondary">Account and security</Link></div><div className="product-legal-links"><Link href="/privacy" className="text-link">Privacy</Link><Link href="/terms" className="text-link">Terms</Link><Link href="/sms-terms" className="text-link">SMS terms</Link></div></section>
  </ProductShell>;
}
