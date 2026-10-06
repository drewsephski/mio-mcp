import Link from "next/link";
import { ArrowRight, FileText, Paperclip, LockKeyhole } from "lucide-react";
import { Brand } from "./components/brand";
import { WorkspaceDemo } from "./components/workspace-demo";

export default function Home() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><Brand /><nav className="site-nav" aria-label="Main navigation"><a href="#how-it-works" className="nav-detail">A little look inside</a><Link href="/auth">Sign in</Link><Link href="/auth?mode=sign-up" className="button button-primary">Join the beta <ArrowRight aria-hidden="true" /></Link></nav></header>
    <main id="main" className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1>Your second brain<br />has a <span>phone number.</span></h1>
          <p>A personal assistant you can text. Send thoughts, reminders, questions, or changes. Mio remembers the rest.</p>
          <div className="hero-actions"><Link className="button button-primary" href="/auth?mode=sign-up">Join the invite-only beta <ArrowRight aria-hidden="true" /></Link><Link className="text-link" href="/auth">I already have an account</Link></div>
          <div className="hero-note"><LockKeyhole aria-hidden="true" />Your notes are private to your account.</div>
        </div>
        <WorkspaceDemo />
      </section>
      <section id="how-it-works" className="landing-details">
        <h2>Less scattered.<br />More space to think.</h2>
        <div className="details-list">
          <div className="detail-row"><FileText aria-hidden="true" /><div><h3>Catch the thought.</h3><p>Connect your phone, then text a thought. Mio remembers it, answers questions, and manages requested reminders. Keep the conversation going.</p></div></div>
          <div className="detail-row"><Paperclip aria-hidden="true" /><div><h3>See what’s scheduled.</h3><p>Inspect the exact time of every reminder. Edit or cancel it from your companion app, with your notes close by.</p></div></div>
          <div className="detail-row"><LockKeyhole aria-hidden="true" /><div><h3>Make it yours.</h3><p>Open Today to see what’s coming up. Search and edit notes, keep attachments alongside them, and revisit your conversation in Activity.</p></div></div>
        </div>
      </section>
      <section className="landing-close"><div><h2>A good place to begin.</h2><p>Mio is starting small, with an invite-only beta.</p></div><Link href="/auth?mode=sign-up" className="button button-primary">Meet Mio <ArrowRight aria-hidden="true" /></Link></section>
      <footer className="site-footer"><Brand /><span>A little room for what matters.</span><nav className="legal-footer-nav" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/sms-terms">SMS terms</Link></nav><Link href="/auth" className="text-link">Open Mio</Link></footer>
    </main>
  </>;
}
