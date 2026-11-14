
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type SearchState = "idle" | "loading" | "success" | "error";
type Lead = Record<string, string | number | boolean | null>;

export default function Home() {
  const [businessType, setBusinessType] = useState("");
  const [location, setLocation] = useState("");
  const [maximumLeads, setMaximumLeads] = useState("100");
  const [state, setState] = useState<SearchState>("idle");
  const [message, setMessage] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    return () => {
      if (fileUrl) URL.revokeObjectURL(fileUrl);
    };
  }, [fileUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setState("loading");
    setMessage("Your search is running. This can take a few minutes…");
    setLeads([]);
    setColumns([]);
    setFilter("");
    setFileName("");

    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
      setFileUrl("");
    }

    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessType: businessType.trim(),
          targetLocation: location.trim(),
          maximumLeads: Number(maximumLeads),
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let detail = "The search could not be completed.";

        if (contentType.includes("application/json")) {
          const data = await response.json();
          detail = data.error || detail;
        } else {
          detail = (await response.text()).slice(0, 500) || detail;
        }

        throw new Error(detail);
      }

      const blob = await response.blob();

      if (!blob.size) {
        throw new Error("The workflow returned an empty Excel file.");
      }

      const workbook = XLSX.read(await blob.arrayBuffer(), {
        type: "array",
      });

      const firstSheetName = workbook.SheetNames[0];

      if (!firstSheetName) {
        throw new Error("The Excel file does not contain a worksheet.");
      }

      const worksheet = workbook.Sheets[firstSheetName];

      const rows = XLSX.utils.sheet_to_json<Lead>(worksheet, {
        defval: "",
        raw: false,
      });

      if (!rows.length) {
        throw new Error("The Excel file was generated, but it contains no lead records.");
      }

      const headers = Object.keys(rows[0]);

      const disposition = response.headers.get("content-disposition") || "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const downloadName =
        match?.[1] || `business-leads-${Date.now()}.xlsx`;

      setLeads(rows);
      setColumns(headers);
      setFileName(downloadName);
      setFileUrl(URL.createObjectURL(blob));
      setState("success");
      setMessage(`Successfully loaded ${rows.length} leads from your Excel file.`);
    } catch (error) {
      setState("error");
      setMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again."
      );
    }
  }

  const filteredLeads = useMemo(() => {
    const query = filter.trim().toLowerCase();

    if (!query) return leads;

    return leads.filter((lead) =>
      columns.some((column) =>
        String(lead[column] ?? "").toLowerCase().includes(query)
      )
    );
  }, [leads, columns, filter]);

  function downloadExcel() {
    if (!fileUrl) return;

    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = fileName || "business-leads.xlsx";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const isLoading = state === "loading";

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="#" aria-label="LeadPilot home">
          <span className="brand-mark"><RadarIcon /></span>
          <span>Lead<span className="brand-accent">Pilot</span></span>
        </a>
        <div className="nav-right">
          <span className="nav-status"><i /> Lead discovery workspace</span>
          <a className="nav-link" href="#how-it-works">How it works <span>↗</span></a>
        </div>
      </nav>

      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> BUSINESS LEAD DISCOVERY, SIMPLIFIED</div>
          <h1>Find businesses.<br /><em>Start conversations.</em></h1>
          <p className="hero-description">
            Discover local businesses with no independent website found and
            publicly available contact details. Turn your next market search
            into an actionable lead list.
          </p>
          <div className="trust-row">
            <span><CheckIcon /> Location-based discovery</span>
            <span><CheckIcon /> Contact detail filtering</span>
            <span><CheckIcon /> Excel export</span>
          </div>
          <div className="hero-note">
            <span className="note-icon"><SparkIcon /></span>
            <span><strong>Less searching, more connecting.</strong><br />One search creates a focused list for your outreach.</span>
          </div>
        </div>

        <div className="form-card" id="search">
          <div className="form-card-top">
            <div>
              <div className="card-kicker">NEW SEARCH</div>
              <h2>Build your lead list</h2>
              <p>Tell us who you want to find.</p>
            </div>
            <div className="form-icon"><SearchIcon /></div>
          </div>

          <form onSubmit={handleSubmit}>
            <label htmlFor="businessType">What type of business?</label>
            <div className="input-wrap">
              <StoreIcon />
              <input
                id="businessType"
                name="businessType"
                placeholder="e.g. Shoe stores, dentists, cafés…"
                value={businessType}
                onChange={(event) => setBusinessType(event.target.value)}
                required
                maxLength={100}
                disabled={isLoading}
              />
            </div>

            <div className="suggestions" aria-label="Business type suggestions">
              {["Dental clinics", "Shoe stores", "Hair salons", "Restaurants"].map((item) => (
                <button
                  className="suggestion"
                  type="button"
                  key={item}
                  onClick={() => setBusinessType(item)}
                  disabled={isLoading}
                >
                  {item}
                </button>
              ))}
            </div>

            <label htmlFor="location">Where should we search?</label>
            <div className="input-wrap">
              <PinIcon />
              <input
                id="location"
                name="targetLocation"
                placeholder="City, region or country"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
                required
                maxLength={120}
                disabled={isLoading}
              />
            </div>

            <label htmlFor="maximumLeads">Maximum number of leads</label>
            <div className="input-wrap select-wrap">
              <UsersIcon />
              <select
                id="maximumLeads"
                name="maximumLeads"
                value={maximumLeads}
                onChange={(event) => setMaximumLeads(event.target.value)}
                disabled={isLoading}
              >
                <option value="25">25 leads</option>
                <option value="50">50 leads</option>
                <option value="100">100 leads</option>
                <option value="250">250 leads</option>
                <option value="500">500 leads</option>
              </select>
              <ChevronIcon />
            </div>

            <button className="submit-button" type="submit" disabled={isLoading}>
              {isLoading ? <><span className="spinner" /> Finding your leads…</> : <>Find business leads <ArrowIcon /></>}
            </button>
            <p className="form-footnote"><LockIcon /> Your search details are used to run this search.</p>
          </form>

          {state !== "idle" && (
            <div className={`result-message ${state}`} role="status" aria-live="polite">
              <span className="result-symbol">
                {state === "loading" ? <span className="spinner dark" /> : state === "success" ? <CheckIcon /> : <AlertIcon />}
              </span>
              <span>
                <strong>{state === "success" ? "Search complete" : state === "error" ? "Search needs attention" : "Working on your search"}</strong>
                <small>{message}</small>
              </span>
            </div>
          )}
        </div>
      </section>

      {state === "success" && leads.length > 0 && (
        <section className="shell lead-results" id="lead-results">
          <div className="results-heading">
            <div>
              <div className="eyebrow">YOUR SEARCH RESULTS</div>
              <h2>Your business leads</h2>
              <p>{leads.length} records extracted directly from your Excel file.</p>
            </div>
            <button className="submit-button download-button" type="button" onClick={downloadExcel}>
              <FileIcon /> Download Excel
            </button>
          </div>

          <div className="results-toolbar">
            <div className="results-count">
              <strong>{filteredLeads.length}</strong> of {leads.length} leads
            </div>
            <input
              className="results-search"
              type="search"
              placeholder="Search across all columns..."
              aria-label="Search leads"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>

          <div className="table-container">
            <table className="leads-table">
              <thead>
                <tr>
                  {columns.map((column) => (
                    <th key={column}>{column.replace(/_/g, " ")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead, index) => (
                  <tr key={index}>
                    {columns.map((column) => {
                      const value = lead[column];
                      const text = String(value ?? "");

                      return (
                        <td key={column}>
                          {/^https?:\/\//i.test(text) ? (
                            <a href={text} target="_blank" rel="noopener noreferrer">
                              Open link ↗
                            </a>
                          ) : text || "—"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {filteredLeads.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="empty-results">
                      No matching leads found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="table-note">
            Scroll horizontally to see all columns. Your results are displayed
            here without needing to download the Excel file.
          </p>
        </section>
      )}

      <section className="metrics shell" id="how-it-works">
        <div className="metrics-heading">
          <span className="eyebrow">A CLEARER WAY TO PROSPECT</span>
          <h2>From search to spreadsheet.</h2>
          <p>Your search is processed by the connected lead-discovery workflow.</p>
        </div>
        <div className="steps">
          <article className="step">
            <span className="step-number">01</span>
            <div className="step-icon"><CompassIcon /></div>
            <h3>Discover</h3>
            <p>Search for businesses in your chosen category and location.</p>
          </article>
          <article className="step">
            <span className="step-number">02</span>
            <div className="step-icon"><ShieldIcon /></div>
            <h3>Check</h3>
            <p>Look for independent websites and public contact details.</p>
          </article>
          <article className="step">
            <span className="step-number">03</span>
            <div className="step-icon"><FileIcon /></div>
            <h3>Export</h3>
            <p>View results online or download the Excel spreadsheet.</p>
          </article>
        </div>
      </section>

      <section className="disclaimer shell">
        <span className="disclaimer-icon"><InfoIcon /></span>
        <p><strong>A note on accuracy:</strong> “No independent website found” means the search did not identify one in the sources checked. It does not prove that a business has no website. Public contact details and search coverage can vary.</p>
      </section>

      <footer className="footer shell">
        <a className="brand footer-brand" href="#"><span className="brand-mark"><RadarIcon /></span><span>Lead<span className="brand-accent">Pilot</span></span></a>
        <span>Business discovery, made more focused.</span>
        <span>© {new Date().getFullYear()} LeadPilot</span>
      </footer>
    </main>
  );
}

function RadarIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.4" /><path d="M12 12 19 5" /></svg>; }
function SearchIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></svg>; }
function StoreIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 10.5 4.5 4h15l1.5 6.5M5 10.5V20h14v-9.5M3 10.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-5h6v5" /></svg>; }
function PinIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2.2" /></svg>; }
function UsersIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 11a3 3 0 1 0-1-5.8M17 14.5h.5a3.5 3.5 0 0 1 3.5 3.5v2" /></svg>; }
function ChevronIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg>; }
function LockIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 1 1 8 0v3" /></svg>; }
function SparkIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" /></svg>; }
function CompassIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2Z" /></svg>; }
function ShieldIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" /><path d="m8.5 12 2.2 2.2 4.8-4.8" /></svg>; }
function FileIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" /><path d="M13 2v7h7M8 13h8M8 17h8" /></svg>; }
function InfoIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" /></svg>; }
function AlertIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 2.8 20h18.4L12 3Z" /><path d="M12 9v4m0 3h.01" /></svg>; }
