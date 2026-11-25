import { useState } from "preact/hooks";
import { useGet, act, type Row } from "./lib";

/** Shrink on the phone before upload (~300 KB instead of 3–5 MB): keeps storage inside the free tier. */
async function shrink(file: File, max = 1600): Promise<Blob> {
  try {
    const img = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error("encode"))), "image/jpeg", 0.8));
  } catch {
    return file; // the server still enforces size and type
  }
}

/** Before / after / site photos in R2, for a lead or a job. */
export function Photos({ leadId, jobId }: { leadId?: string; jobId?: string }) {
  const path = jobId ? `/api/crm/jobs/${jobId}` : `/api/crm/leads/${leadId}`;
  const { data, reload } = useGet<Row>(path);
  const [kind, setKind] = useState("before");
  const [busy, setBusy] = useState(false);
  const photos: Row[] = data?.photos ?? [];
  const upload = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files?.length) return;
    setBusy(true);
    for (const file of files) {
      const fd = new FormData();
      fd.append("file", new File([await shrink(file)], "photo.jpg", { type: "image/jpeg" }));
      fd.append("kind", kind);
      if (leadId) fd.append("lead_id", leadId);
      if (jobId) fd.append("job_id", jobId);
      const r = await fetch("/api/crm/photos", { method: "POST", body: fd });
      if (!r.ok) alert(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? "Upload failed");
    }
    setBusy(false);
    (e.target as HTMLInputElement).value = "";
    reload();
  };
  return (
    <section class="c-card">
      <h2>Photos</h2>
      <div class="c-photos">
        {photos.map((p) => (
          <figure key={p.id}><a href={`/api/crm/photos/${p.id}`} target="_blank" rel="noopener"><img src={`/api/crm/photos/${p.id}`} alt={`${p.kind} photo`} loading="lazy" /></a>
            <figcaption>{p.kind} <button class="c-x" aria-label="Delete photo" onClick={async () => { if (confirm("Delete this photo?") && await act("DELETE", `/api/crm/photos/${p.id}`)) reload(); }}>×</button></figcaption></figure>
        ))}
      </div>
      <div class="c-actions">
        <div class="c-chips">{["before", "after", "site"].map((k) => <button type="button" class={`c-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{k}</button>)}</div>
        <label class="c-btn">{busy ? "Uploading…" : "Add photos"}<input type="file" accept="image/*" multiple hidden onChange={upload} /></label>
      </div>
    </section>
  );
}
