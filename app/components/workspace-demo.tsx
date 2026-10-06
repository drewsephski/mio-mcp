"use client";

import { useState } from "react";
import { Bell, Check, FileText, MessageCircle, ArrowDown } from "lucide-react";

const examples = [
  {
    label: "Remember a thought",
    message: "Remember: the spare keys are in the blue bowl by the door.",
    reply: "Got it. Your spare keys are in the blue bowl by the door.",
    type: "Saved note",
    title: "Where the spare keys are",
    detail: "In the blue bowl by the door.",
    icon: FileText,
  },
  {
    label: "Set a reminder",
    message: "Remind me tomorrow at 10 am to book the dentist.",
    reply: "I’ll remind you tomorrow at 10 am to book the dentist.",
    type: "Scheduled reminder",
    title: "Book the dentist",
    detail: "Tomorrow · 10:00 am · America/Chicago",
    icon: Bell,
  },
  {
    label: "Find it later",
    message: "Where did I put the spare keys?",
    reply: "Your spare keys are in the blue bowl by the door.",
    type: "Referenced note",
    title: "Where the spare keys are",
    detail: "The thought you saved, when you need it.",
    icon: FileText,
  },
];

export function WorkspaceDemo() {
  const [selected, setSelected] = useState(0);
  const example = examples[selected];
  const Icon = example.icon;

  return <div className="demo-wrap">
    <div className="demo-window">
      <div className="demo-top"><div className="demo-contact"><span className="demo-contact-icon"><MessageCircle size={19} aria-hidden="true" /></span><div><strong>Mio</strong><small>Your personal assistant</small></div></div><span className="demo-example-label">Example conversation</span></div>
      <div className="demo-conversation" aria-live="polite" aria-atomic="true">
        <p className="demo-message demo-message-you">{example.message}</p>
        <p className="demo-message demo-message-mio">{example.reply}</p>
        <div className="demo-result-label"><ArrowDown size={14} aria-hidden="true" />In your web companion</div>
        <div className="demo-result"><span className="demo-result-icon"><Icon size={19} aria-hidden="true" /></span><div><small>{example.type}</small><h2>{example.title}</h2><p>{example.detail}</p></div><Check size={16} aria-hidden="true" /></div>
      </div>
      <div className="demo-options" role="group" aria-label="Choose an example">{examples.map((item, index) => <button key={item.label} type="button" aria-pressed={selected === index} onClick={() => setSelected(index)}>{item.label}</button>)}</div>
    </div>
    <p className="demo-caption">Try an example. These messages are illustrative; nothing is sent or saved.</p>
  </div>;
}
