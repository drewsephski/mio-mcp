import Link from "next/link";
import { Brand } from "../components/brand";
import { SignOutButton } from "../components/sign-out-button";
export default function BetaAccessPage() {
  return <main className="sms-settings-shell"><Brand /><section className="sms-settings-card"><h1>Mio is invite-only.</h1><p className="muted">Sign in with the email address on your invitation. Having an account alone doesn’t grant beta access.</p><SignOutButton /><Link href="/" className="text-link">About Mio</Link></section></main>;
}
