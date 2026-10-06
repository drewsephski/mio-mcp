import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "./brand";

export function AuthShell({ title, description, eyebrow, children }: {
  title: string;
  description: string;
  eyebrow?: string;
  children: ReactNode;
}) {
  return <main className="auth-shell">
    <header><Brand /><Link href="/" className="text-link">Back to home</Link></header>
    <section className="auth-card" aria-labelledby="auth-title">
      {eyebrow && <p className="product-eyebrow">{eyebrow}</p>}
      <h1 id="auth-title">{title}</h1>
      <p>{description}</p>
      {children}
    </section>
    <p className="auth-caption">Mio · A personal assistant you can text.</p>
  </main>;
}
