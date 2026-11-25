import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../api";

export type Row = Record<string, any>;

export function useGet<T = Row>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>("GET", path)); setError(null); } catch (e) { setError((e as Error).message); }
  }, [path]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, reload: load };
}

/** Runs a write; shows the server's message on failure. Returns true on success. */
export async function act(method: string, path: string, body?: unknown): Promise<any> {
  try { return (await api(method, path, body)) ?? true; } catch (e) { alert((e as Error).message); return null; }
}

const TZ = "America/Toronto";
export const money = (c: number | null | undefined, cents = false) =>
  c == null ? "—" : (c / 100).toLocaleString("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: cents ? 2 : 0, minimumFractionDigits: cents ? 2 : 0 });
export const dollarsToCents = (s: string) => Math.round(parseFloat(s.replace(/[$,\s]/g, "") || "0") * 100);
export const centsToInput = (c: number) => (c / 100).toFixed(2).replace(/\.00$/, "");
export const pct = (x: number | null | undefined) => (x == null ? "—" : `${x}%`);

export function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 0) return "in " + until(iso);
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}
function until(iso: string) {
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  return m < 60 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
}
export const when = (iso: string) => new Date(iso).toLocaleString("en-CA", { timeZone: TZ, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ, month: "short", day: "numeric" });
export const todayToronto = () => new Date().toLocaleDateString("en-CA", { timeZone: TZ });
export const phonePretty = (p: string) => p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "$1-$2-$3");

export const first = (name: string) => (name?.trim().split(/\s+/)[0] || "there").replace(/^./, (c) => c.toUpperCase());
export const street = (line1?: string | null) => (line1 ?? "").split(",")[0].replace(/^\s*(unit\s*\S+\s*)?[\w-]*\d[\w-]*\s+/i, "");

/** Customer-facing links go on the public go. host (crm. is behind the login). */
export const publicOrigin = () => location.origin.replace("//crm.", "//go.");

export function fill(body: string, lead: Row, settings: Row, extra: Row = {}) {
  const vars: Record<string, string> = {
    first: first(lead.name ?? ""), me: settings.owner_name ?? "", service: (lead.service || "project").toLowerCase(),
    street: street(lead.line1) || "your place", review_link: settings.review_link ?? "",
    quote_link: extra.quote_token ? `${publicOrigin()}/api/quote/${extra.quote_token}` : "(quote link)", video_link: extra.video_link ?? "(video link)",
  };
  return body.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}

export const telHref = (p: string) => `tel:${p}`;
export const smsHref = (p: string, body: string) => `sms:${p}?&body=${encodeURIComponent(body)}`;
export const mailHref = (to: string, subject: string, body: string) => `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

export const STAGE_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", visit: "Visit booked", quoted: "Quoted", won: "Won", lost: "Lost", later: "Later" };
export const SOURCES = ["phone", "website", "qr", "email", "facebook", "referral", "google_gbp", "walk-in", "yard-sign", "other"];
export const SERVICES = ["Interlocking Driveways", "Retaining Walls", "Garden Design", "Sod Installation", "Gardening & Garden Maintenance", "Lawn Care & Grass", "Drainage & Grading", "Fencing", "Something else"];

export function download(path: string) {
  const a = document.createElement("a");
  a.href = path;
  a.download = "";
  a.click();
}
