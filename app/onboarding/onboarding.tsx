"use client";
import { useState } from "react";
import { MessageSquare } from "lucide-react";
import type { SmsStatus } from "@/lib/sms";
import { SmsSettings } from "@/app/settings/sms/sms-settings";
const examples = ["Remind me about my workout at 4 pm.", "Actually, make that 4:30 pm.", "Where did I put the spare keys?", "Remember I want to call my mom Sunday."];
export function Onboarding(props: { initialStatus: SmsStatus; ownerId: string; databaseId: string }) {
  const [step, setStep] = useState(props.initialStatus.connected ? "connect" : "meet");
  return <><div className="sms-settings-icon"><MessageSquare aria-hidden="true" /></div><p className="onboarding-step">{step === "meet" ? "1 of 2 · Meet your assistant" : "2 of 2 · Make it yours"}</p><h1>{step === "meet" ? "Meet Mio." : props.initialStatus.connected ? "Your assistant is ready." : "Connect your phone."}</h1>{step === "meet" ? <><p className="muted">Text a thought, ask about something you saved, or set a reminder. See your notes and schedule in the app.</p><ul className="onboarding-examples">{examples.map(text => <li key={text}>“{text}”</li>)}</ul><button className="button button-primary" onClick={() => setStep("connect")}>Connect my phone</button></> : <SmsSettings {...props} onboarding />}</>;
}
