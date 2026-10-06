"use client";

import { useAuth } from "@appwrite.io/react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

export function SignOutButton() {
  const { signOut } = useAuth();
  const router = useRouter();
  return <><button type="button" className="icon-button" aria-label="Sign out" title="Sign out" disabled={signOut.isPending} onClick={() => {
    if (document.querySelector("#note-form")?.getAttribute("data-dirty") === "true" && !window.confirm("Sign out and discard your unsaved changes?")) return;
    signOut.signOut({ onSuccess: () => { router.replace("/auth"); router.refresh(); } });
  }}><LogOut aria-hidden="true" /></button>{signOut.error && <span role="alert" className="notice-error text-xs">Unable to sign out. Try again.</span>}</>;
}
