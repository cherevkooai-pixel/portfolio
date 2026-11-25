import { useEffect, useMemo, useState } from "preact/hooks";
import { AppContext } from "./context";
import type { View } from "./types";
import { useAppState } from "./hooks/use-app";
import { useRouter } from "./hooks/use-router";
import { Sidebar } from "./components/sidebar";
import { Dashboard } from "./components/dashboard";
import { ScheduleView } from "./components/schedule-view";
import { JobList } from "./components/job-list";
import { JobDetail } from "./components/job-detail";
import { CustomerList } from "./components/customer-list";
import { CustomerDetail } from "./components/customer-detail";
import { TechnicianList } from "./components/technician-list";
import { ServiceTypeList } from "./components/service-type-list";
import { MaterialList } from "./components/material-list";
import { InvoiceList } from "./components/invoice-list";
import { InvoiceDetail } from "./components/invoice-detail";
import { AssetDetail } from "./components/asset-detail";
import { ErrorBanner } from "./components/error-banner";
import { OfflineBanner } from "./components/offline-banner";
import { Today } from "./crm/today";
import { Celebrations } from "./crm/fx";
import { Leads, AddLead, LeadDetail } from "./crm/leads";
import { QuoteEditor } from "./crm/quote";
import { Inbox } from "./crm/inbox";
import { Numbers } from "./crm/numbers";
import { More, Campaigns, CampaignDetail, PrintSheet, Warm, PriceBook, Templates, Settings } from "./crm/more";

export function App() {
  const isAgent = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.has("agent") || params.get("mode") === "agent";
  }, []);

  useEffect(() => {
    if (isAgent) {
      document.documentElement.setAttribute("data-agent", "");
    }
  }, [isAgent]);

  const { view, id, sub, navigate } = useRouter();
  const appState = useAppState(isAgent, navigate);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Load detail when URL has an ID
  useEffect(() => {
    setDetailError(null);
    if (view === "jobs" && id) {
      appState.selectJob(id).catch((err) => setDetailError((err as Error).message));
    } else if (view === "customers" && id) {
      appState.selectCustomer(id).catch((err) => setDetailError((err as Error).message));
    } else if (view === "invoices" && id) {
      appState.selectInvoice(id).catch((err) => setDetailError((err as Error).message));
    }
  }, [view, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const renderMain = () => {
    if (view === "leads") return id === "new" ? <AddLead /> : id ? <LeadDetail key={id} id={id} /> : <Leads />;
    if (view === "quotes" && id) return <QuoteEditor key={id} id={id} />;
    if (view === "campaigns") return id ? (sub === "print" ? <PrintSheet id={id} /> : <CampaignDetail key={id} id={id} />) : <Campaigns />;
    const crmViews: Partial<Record<View, () => any>> = { today: Today, inbox: Inbox, numbers: Numbers, more: More, warm: Warm, pricebook: PriceBook, templates: Templates, settings: Settings };
    const Crm = crmViews[view];
    if (Crm) return <Crm />;
    if (view === "assets" && id) return <AssetDetail key={id} id={id} />;
    if (view === "jobs" && id) {
      if (appState.selectedJob) return <JobDetail />;
      return <div class="page"><div class="empty-state" role={detailError ? "alert" : "status"}>
        <h2>{detailError ? "Job unavailable" : "Loading job…"}</h2>
        {detailError && <p>{detailError}</p>}
        {detailError && <button class="btn" onClick={() => navigate("/schedule")}>Back to schedule</button>}
      </div></div>;
    }
    if (view === "customers" && id && appState.selectedCustomer) return <CustomerDetail />;
    if (view === "invoices" && id && appState.selectedInvoice) return <InvoiceDetail />;
    switch (view) {
      case "schedule": return <ScheduleView />;
      case "jobs": return <JobList />;
      case "customers": return <CustomerList />;
      case "technicians": return <TechnicianList />;
      case "services": return <ServiceTypeList />;
      case "materials": return <MaterialList />;
      case "invoices": return <InvoiceList />;
      case "dashboard": return <Dashboard />;
      default: return <Today />;
    }
  };

  return (
    <AppContext.Provider value={appState}>
      <div class="layout">
        <Sidebar currentView={view} />
        <main class="main-content">
          <OfflineBanner />
          {appState.loading ? (
            <div class="loading-text">Loading...</div>
          ) : (
            renderMain()
          )}
        </main>
      </div>
      <ErrorBanner />
      <Celebrations />
    </AppContext.Provider>
  );
}
