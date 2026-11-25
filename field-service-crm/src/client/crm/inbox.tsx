import { useState } from "preact/hooks";
import { useGet, type Row } from "./lib";
import { EmailCard } from "./today";

const TABS: [string, string][] = [["lead", "Possible leads"], ["other", "Other"], ["spam", "Spam"], ["all", "All"]];

export function Inbox() {
  const [cat, setCat] = useState("lead");
  const { data, error, reload } = useGet<Row>(`/api/crm/emails?category=${cat}`);
  const emails: Row[] = data?.emails ?? [];
  return (
    <div class="c-page">
      <header class="c-head"><h1>Inbox</h1><span class="c-mut c-small">Gmail, sorted every 5 min</span></header>
      <div class="c-chips" role="tablist">
        {TABS.map(([k, l]) => <button role="tab" aria-selected={cat === k} class={`c-chip ${cat === k ? "on" : ""}`} onClick={() => setCat(k)}>{l}{k !== "all" && data?.counts?.[k] ? <span>{data.counts[k]}</span> : null}</button>)}
      </div>
      {error && <p class="c-err">{error}</p>}
      {data && !emails.length && <p class="c-empty">{cat === "lead" ? "No possible leads right now." : "Nothing here."} Emails arrive once the Gmail script is installed (More → Setup).</p>}
      {emails.filter((e) => cat !== "lead" || (!e.dismissed && !e.lead_id) || e.lead_id).map((e) => <EmailCard key={e.id} e={e} onDone={reload} />)}
    </div>
  );
}
