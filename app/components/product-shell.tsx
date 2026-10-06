import type { ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, FileText, Bell, History, Settings, LockKeyhole } from "lucide-react";
import { Brand } from "./brand";
import { SignOutButton } from "./sign-out-button";
import { ProductLiveRefresh } from "@/app/today/live-refresh";
import { getResourceIds } from "@/lib/config";

const destinations = [
  { key: "today", href: "/today", label: "Today", icon: CalendarDays },
  { key: "notes", href: "/dashboard", label: "Notes", icon: FileText },
  { key: "reminders", href: "/reminders", label: "Reminders", icon: Bell },
  { key: "activity", href: "/activity", label: "Activity", icon: History },
  { key: "settings", href: "/settings", label: "Settings", icon: Settings },
] as const;
export type ProductSection = typeof destinations[number]["key"];

export function ProductNavigation({ active, className = "product-nav" }: { active: ProductSection; className?: string }) {
  return <nav className={className} aria-label="Main navigation">{destinations.map(({ key, href, label, icon: Icon }) => <Link key={key} href={href} className={active === key ? "active" : undefined} aria-current={active === key ? "page" : undefined}><Icon size={17} aria-hidden="true" /><span>{label}</span></Link>)}</nav>;
}

export function ProductShell({ active, title, description, user, actions, children }: {
  active: ProductSection; title: string; description?: string; user: { $id: string; name: string; email: string }; actions?: ReactNode; children: ReactNode;
}) {
  return <div className="product-shell">
    <a href="#product-main" className="skip-link">Skip to content</a>
    <aside className="product-sidebar"><Brand href="/today" /><ProductNavigation active={active} /><div className="product-sidebar-bottom"><p className="product-private"><LockKeyhole size={13} aria-hidden="true" />Your private assistant</p><div className="account-summary"><span className="avatar">{(user.name || user.email).slice(0, 1).toUpperCase()}</span><div><strong>{user.name || "Your account"}</strong><small>{user.email}</small></div><SignOutButton /></div></div></aside>
    <div className="product-main"><div className="product-mobile-brand"><Brand href="/today" /><SignOutButton /></div><div className="product-mobile-nav"><ProductNavigation active={active} /></div><header className="product-header"><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="product-header-actions">{actions}</div>}</header><main id="product-main" className="product-content"><ProductLiveRefresh ownerId={user.$id} databaseId={getResourceIds().databaseId} section={active} />{children}</main></div>
  </div>;
}
