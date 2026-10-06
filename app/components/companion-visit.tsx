"use client";
import { useEffect } from "react";
export function CompanionVisit() {
  useEffect(() => { void fetch("/api/visit", { method: "POST" }).catch(() => {}); }, []);
  return null;
}
