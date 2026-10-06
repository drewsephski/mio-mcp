import Link from "next/link";
import { ArrowRight, FileText, Paperclip, LockKeyhole } from "lucide-react";
import { Brand } from "./components/brand";
import { WorkspaceDemo } from "./components/workspace-demo";

export default function Home() {
  return <>
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header"><Brand /><nav className="site-nav" aria-label="Main navigation"><a href="#how-it-works" className="nav-detail">A little look inside</a><Link href="/auth">Sign in</Link><Link href="/auth?mode=sign-up" className="button button-primary">Get started <ArrowRight aria-hidden="true" /></Link></nav></header>
    <main id="main" className="landing">
      <section className="hero">
        <div className="hero-copy">
          <h1>Your thoughts.<br />A little more <span>room.</span></h1>
          <p>A quiet place for your notes, ideas, and the files that belong with them. All together, in your own workspace.</p>
          <div className="hero-actions"><Link className="button button-primary" href="/auth?mode=sign-up">Create your workspace <ArrowRight aria-hidden="true" /></Link><Link className="text-link" href="/auth">I already have an account</Link></div>
          <div className="hero-note"><LockKeyhole aria-hidden="true" />Your notes are private to your account.</div>
        </div>
        <WorkspaceDemo />
      </section>
      <section id="how-it-works" className="landing-details">
        <h2>Less scattered.<br />More space to think.</h2>
        <div className="details-list">
          <div className="detail-row"><FileText aria-hidden="true" /><div><h3>Catch the thought.</h3><p>Start a note, give it a title, and write without formatting getting in the way. Find it again with title search.</p></div></div>
          <div className="detail-row"><Paperclip aria-hidden="true" /><div><h3>Keep the context.</h3><p>Attach a document, image, or text file right beside your note. No hunting through another folder.</p></div></div>
          <div className="detail-row"><LockKeyhole aria-hidden="true" /><div><h3>Make it yours.</h3><p>Your account has its own notes and files. Archive what you’re finished with and return to it whenever you need.</p></div></div>
        </div>
      </section>
      <section className="landing-close"><div><h2>A good place to begin.</h2><p>One note is all it takes to make a little room.</p></div><Link href="/auth?mode=sign-up" className="button button-primary">Write your first note <ArrowRight aria-hidden="true" /></Link></section>
      <footer className="site-footer"><Brand /><span>A little room for what matters.</span><Link href="/auth" className="text-link">Open Mio</Link></footer>
    </main>
  </>;
}
