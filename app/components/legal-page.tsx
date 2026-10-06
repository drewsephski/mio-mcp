import type { ReactNode } from "react";
import Link from "next/link";
import { z } from "zod";
import { Brand } from "./brand";
export function SupportContact() {
  const email = z.email().safeParse(process.env.MIO_SUPPORT_EMAIL ?? "drewsepeczi@gmail.com");
  return email.success ? <>email <a className="text-link" href={`mailto:${email.data}`}>{email.data}</a></> : <>contact the person who invited you to the Mio beta</>;
}
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return <main className="legal-shell"><header><Brand /><Link href="/" className="text-link">Back to home</Link></header><article><p className="product-eyebrow">Mio · Effective October 6, 2026</p><h1>{title}</h1><p>Operated by {process.env.MIO_OPERATOR_NAME ?? "Drew Sepeczi"}.</p>{children}<section><h2>Contact</h2><p>For questions, support, or privacy requests, <SupportContact />.</p></section></article><nav className="legal-footer-nav" aria-label="Legal"><Link href="/privacy">Privacy Policy</Link><Link href="/terms">Terms</Link><Link href="/sms-terms">SMS terms</Link></nav></main>;
}
