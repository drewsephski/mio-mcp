import type { Metadata } from "next";
import Link from "next/link";
import { requireBetaPage } from "@/lib/beta-page";
import { getResourceIds } from "@/lib/config";
import { getSmsStatus } from "@/lib/sms";
import { Brand } from "@/app/components/brand";
import { Onboarding } from "./onboarding";
import { VerificationBanner } from "@/app/account/verification-banner";
import { RefreshButton } from "@/app/today/refresh-button";
export const metadata: Metadata = { title: "Meet Mio", robots: { index: false, follow: false } };
export default async function OnboardingPage() {
  const user = await requireBetaPage(false);
  const status = user.emailVerification ? await getSmsStatus().catch(() => null) : null;
  return <main className="sms-settings-shell"><header><Brand /><Link href="/today" className="text-link">Open Mio</Link></header><section className="sms-settings-card">{!user.emailVerification ? <><h1>Confirm your invitation.</h1><p className="muted">Verify your invited email to open Mio and connect your phone.</p><div className="sms-settings-content"><div className="w-full"><VerificationBanner userEmail={user.email} /></div><RefreshButton label="Check verification" /></div></> : status ? <Onboarding initialStatus={status} ownerId={user.$id} databaseId={getResourceIds().databaseId} /> : <><h1>Meet Mio.</h1><p className="notice notice-error" role="alert">Phone setup is temporarily unavailable. Reload to try again.</p><Link className="text-link" href="/today">Open your web companion</Link></>}</section></main>;
}
