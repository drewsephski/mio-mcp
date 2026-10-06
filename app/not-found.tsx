import Link from "next/link";
import { AuthShell } from "./components/auth-shell";

export default function NotFound() {
  return <AuthShell eyebrow="Page not found" title="This page isn’t here." description="The link may have changed. Head home or open your Mio account.">
    <div className="form-stack"><Link href="/" className="button button-primary">Back to home</Link><Link href="/today" className="button button-secondary">Open Mio</Link></div>
  </AuthShell>;
}
