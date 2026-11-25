import { useState } from "preact/hooks";
import { useApp } from "../context";
import { PanelLeft, Sprout, Sun, Users, Inbox, CalendarDays, BarChart3, Menu } from "lucide-preact";
import type { View } from "../types";

const navItems: { view: View; path: string; label: string; icon: typeof Sun; also?: View[] }[] = [
  { view: "today", path: "/", label: "Today", icon: Sun },
  { view: "leads", path: "/leads", label: "Leads", icon: Users, also: ["quotes"] },
  { view: "inbox", path: "/inbox", label: "Inbox", icon: Inbox },
  { view: "schedule", path: "/schedule", label: "Jobs", icon: CalendarDays, also: ["jobs"] },
  { view: "numbers", path: "/numbers", label: "Numbers", icon: BarChart3 },
  { view: "more", path: "/more", label: "More", icon: Menu, also: ["campaigns", "warm", "pricebook", "templates", "settings", "customers", "assets", "invoices", "materials", "technicians", "services", "dashboard"] },
];

export function Sidebar({ currentView }: { currentView: View }) {
  const { navigate } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const active = (item: (typeof navItems)[number]) => currentView === item.view || !!item.also?.includes(currentView);
  return (
    <aside class={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div class="sidebar-brand">
        <div class="sidebar-brand-icon"><Sprout size={16} /></div>
        <span class="sidebar-brand-name">Solid CRM</span>
        <button class="btn-icon" aria-label={collapsed ? "Expand navigation" : "Collapse navigation"} onClick={() => setCollapsed(!collapsed)}><PanelLeft size={16} /></button>
      </div>
      <nav class="sidebar-nav" aria-label="Main">
        {navItems.map((item) => (
          <button key={item.view} title={item.label} aria-current={active(item) ? "page" : undefined}
            class={`sidebar-item ${active(item) ? "active" : ""}`} onClick={() => navigate(item.path)}>
            <item.icon size={18} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </aside>
  );
}
