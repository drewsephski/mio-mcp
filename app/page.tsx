import Link from "next/link";
import { ArrowRight, FileText, MessageCircle, Bell, LockKeyhole, History, CalendarDays } from "lucide-react";
import { Brand } from "./components/brand";
import { WorkspaceDemo } from "./components/workspace-demo";

const features = [
  { icon: MessageCircle, title: "Keep the thought.", description: "An idea on your walk. The name of that restaurant. Where you put the spare keys. Text it to Mio and come back to it later.", example: "Remember: the spare keys are in the blue bowl." },
  { icon: Bell, title: "Remember the moment.", description: "Tell Mio what you need to do and when. Check the exact reminder time in the app, or ask to move it in your conversation.", example: "Remind me tomorrow at 10 to book the dentist." },
  { icon: FileText, title: "Pick up the thread.", description: "Ask about something you saved. Mio uses your notes and recent conversation to help you find the detail you need.", example: "Where did I put the spare keys?" },
];

export default function Home() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><Brand /><nav className="site-nav" aria-label="Main navigation"><a href="#how-it-works" className="nav-detail">How Mio works</a><Link href="/auth">Sign in</Link><Link href="/auth?mode=sign-up" className="button button-primary">Join the beta <ArrowRight aria-hidden="true" /></Link></nav></header>
    <main id="main" className="landing">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="product-eyebrow">Your personal assistant, over text</p>
          <h1 id="hero-title">A little less<br />on your mind.<br /><span>Just text Mio.</span></h1>
          <p>Keep a thought. Set a reminder. Find what you saved. One conversation, with a place for everything you want to remember.</p>
          <div className="hero-actions"><Link className="button button-primary" href="/auth?mode=sign-up">Join the invite-only beta <ArrowRight aria-hidden="true" /></Link><a className="hero-secondary" href="#how-it-works">See how it works <ArrowRight size={15} aria-hidden="true" /></a></div>
          <p className="hero-note"><LockKeyhole aria-hidden="true" />Your notes stay private to your account.</p>
        </div>
        <WorkspaceDemo />
      </section>
      <section id="how-it-works" className="landing-details" aria-labelledby="details-title">
        <div className="landing-section-heading"><div><p className="product-eyebrow">A conversation you can come back to</p><h2 id="details-title">Text it now.<br />Have it when you need it.</h2></div><p>No new habit to learn. Connect your phone, open Messages, and tell Mio what’s on your mind.</p></div>
        <div className="details-list">{features.map(({ icon: Icon, title, description, example }) => <article className="detail-card" key={title}><span className="detail-icon"><Icon size={21} aria-hidden="true" /></span><h3>{title}</h3><p>{description}</p><blockquote>{example}</blockquote></article>)}</div>
      </section>
      <section className="landing-companion" aria-labelledby="companion-title">
        <div className="companion-copy"><p className="product-eyebrow">Your web companion</p><h2 id="companion-title">The conversation.<br />The whole picture.</h2><p>Text when it’s easiest. Open Mio when you want to see your day, edit a note, or check a reminder.</p><Link className="text-link" href="/auth">Open Mio <ArrowRight size={15} aria-hidden="true" /></Link></div>
        <dl className="companion-features"><div><dt><CalendarDays size={19} aria-hidden="true" />Today</dt><dd>Your upcoming reminders and recently saved thoughts.</dd></div><div><dt><FileText size={19} aria-hidden="true" />Notes</dt><dd>Search, edit, and keep files alongside your notes.</dd></div><div><dt><Bell size={19} aria-hidden="true" />Reminders</dt><dd>Exact times, clear status, and controls to edit or cancel.</dd></div><div><dt><History size={19} aria-hidden="true" />Activity</dt><dd>Your SMS conversation and the notes Mio referred to.</dd></div></dl>
      </section>
      <section className="landing-close" aria-labelledby="join-title"><div><p className="product-eyebrow">Starting small</p><h2 id="join-title">Make a little room.</h2><p>Have an invitation? Your assistant is a few steps away.</p></div><Link href="/auth?mode=sign-up" className="button button-primary">Create your account <ArrowRight aria-hidden="true" /></Link></section>
      <footer className="site-footer"><div className="footer-brand"><Brand /><span>A personal assistant you can text.</span></div><nav className="legal-footer-nav" aria-label="Legal"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/sms-terms">SMS terms</Link></nav><Link href="/auth" className="text-link">Sign in <ArrowRight size={14} aria-hidden="true" /></Link></footer>
    </main>
  </>;
}
