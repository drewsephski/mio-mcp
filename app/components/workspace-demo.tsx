"use client";

import { useState } from "react";
import { FileText, Archive, Search, Paperclip, LockKeyhole, Plus, Check } from "lucide-react";
import { Brand } from "./brand";

const examples = [
  { title: "A few things for Monday", preview: "Start with the important things.", body: "A little space to think before the week starts.\n\nFinish the first draft.\nMake time for the longer walk.\nKeep the afternoon open.", file: "Monday-outline.pdf" },
  { title: "An idea worth keeping", preview: "A thought from the train ride.", body: "What if the next project started smaller?\n\nOne clear purpose. A useful first version. Enough room to grow when it needs to.", file: "Project-notes.txt" },
  { title: "The next little adventure", preview: "Places, plans, and possibilities.", body: "Somewhere with a good bookshop.\n\nA slow morning, a new route, and no particular rush to get back.", file: "Weekend-plan.pdf" },
];

export function WorkspaceDemo() {
  const [selected, setSelected] = useState(0);
  const note = examples[selected];
  return <div className="demo-wrap">
    <div className="demo-window">
      <div className="demo-top"><Brand /><span>Example workspace</span></div>
      <div className="demo-body">
        <div className="demo-rail" aria-hidden="true"><FileText className="active" /><Archive /><Search /></div>
        <div className="demo-list">
          <div className="demo-list-head"><span>My notes</span><Plus size={13} aria-hidden="true" /></div>
          {examples.map((item, index) => <button key={item.title} className={`demo-note ${selected === index ? "selected" : ""}`} onClick={() => setSelected(index)} aria-pressed={selected === index}><strong>{item.title}</strong><small>{item.preview}</small></button>)}
        </div>
        <div className="demo-editor"><small>Monday, October 5</small><h2>{note.title}</h2><p>{note.body}</p><div className="demo-file"><Paperclip size={13} aria-hidden="true" />{note.file}</div></div>
      </div>
    </div>
    <div className="demo-caption"><span><Check aria-hidden="true" />Try selecting a note</span><span><LockKeyhole aria-hidden="true" />Example content. Nothing is saved.</span></div>
  </div>;
}
