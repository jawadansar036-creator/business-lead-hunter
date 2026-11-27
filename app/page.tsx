
"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

type SearchState = "idle" | "loading" | "success" | "error";

type Lead = Record<string, any>;

type SearchSummary = {
  total_leads: number;
  osm_leads_found: number;
  web_discovery_leads_found: number;
  researched_leads: number;
  website_candidates: number;
  businesses_with_website_listed: number;
  potential_website_prospects: number;
  prospects_with_contact_details: number;
  prospects_missing_contact_details: number;
  search_location?: string;
};

type LeadView = "all" | "prospects" | "candidates" | "websites";

export default function Home() {
  const [businessType, setBusinessType] = useState("");
  const [location, setLocation] = useState("");
  const [maximumLeads, setMaximumLeads] = useState("100");

  const [state, setState] = useState<SearchState>("idle");
  const [message, setMessage] = useState("");

  const [fileName, setFileName] = useState("");
  const [fileUrl, setFileUrl] = useState("");

  const [leads, setLeads] = useState<Lead[]>([]);
  const [summary, setSummary] = useState<SearchSummary | null>(null);

  const [filter, setFilter] = useState("");
  const [leadView, setLeadView] = useState<LeadView>("all");

  useEffect(() => {
    return () => {
      if (fileUrl) {
        URL.revokeObjectURL(fileUrl);
      }
    };
  }, [fileUrl]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setState("loading");
    setMessage("Searching businesses. Please wait...");

    setLeads([]);
    setSummary(null);
    setFilter("");
    setLeadView("all");
    setFileName("");

    if (fileUrl) {
      URL.revokeObjectURL(fileUrl);
      setFileUrl("");
    }

    try {
      const apiUrl = (
        process.env.NEXT_PUBLIC_API_URL ||
        "http://127.0.0.1:8000"
      ).replace(/\/+$/, "");

      let data: any;

      if (apiUrl.includes("hf.space") || apiUrl.includes("huggingface.co")) {
        // Gradio Space API (2-step POST + SSE result)
        const initResponse = await fetch(
          `${apiUrl}/gradio_api/call/search_leads`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              data: [
                businessType.trim(),
                location.trim(),
                Number(maximumLeads),
              ],
            }),
          }
        );

        if (!initResponse.ok) {
          const errText = await initResponse.text();
          throw new Error(errText || "Failed to start search on backend.");
        }

        const { event_id } = await initResponse.json();
        if (!event_id) {
          throw new Error("Backend did not return a search job ID.");
        }

        const resultResponse = await fetch(
          `${apiUrl}/gradio_api/call/search_leads/${event_id}`
        );

        if (!resultResponse.ok) {
          const errText = await resultResponse.text();
          throw new Error(errText || "Failed to fetch search results.");
        }

        const sseText = await resultResponse.text();
        const lines = sseText.split(/\r?\n/);
        let lastEvent = "";
        let completePayload: any = null;
        let errorPayload: string | null = null;

        for (const line of lines) {
          if (line.startsWith("event:")) {
            lastEvent = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            const raw = line.slice(5).trim();
            if (lastEvent === "error") {
              errorPayload = raw;
            } else if (lastEvent === "complete") {
              try {
                const parsed = JSON.parse(raw);
                completePayload = Array.isArray(parsed) ? parsed[0] : parsed;
              } catch {
                // Ignore malformed intermediate chunks
              }
            }
          }
        }

        if (errorPayload) {
          throw new Error(errorPayload);
        }

        if (!completePayload) {
          throw new Error("Search completed without returning data.");
        }

        if (completePayload.error) {
          throw new Error(completePayload.error);
        }

        data = completePayload;
      } else {
        const response = await fetch(`${apiUrl}/api/search`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            business_type: businessType.trim(),
            target_location: location.trim(),
            maximum_leads: Number(maximumLeads),
          }),
        });

        data = await response.json();

        if (!response.ok) {
          throw new Error(
            typeof data.detail === "string"
              ? data.detail
              : JSON.stringify(
                  data.detail || "Business search failed."
                )
          );
        }
      }

      const rows = Array.isArray(data.businesses)
        ? (data.businesses as Lead[])
        : [];

      if (rows.length === 0) {
        throw new Error(
          "No businesses were found. Try another location or business type."
        );
      }

      // Prepare clean Excel export columns.
      const exportRows = rows.map((lead) => ({
        Business: lead.business_name || lead.name || "",
        Category: lead.business_type || businessType,
        Location: lead.location || lead.search_location || "",
        Phone: lead.phone || "",
        Email: lead.email || "",
        Website: lead.website || "",
        Website_Status: lead.website_status || "not_checked",
        Website_Verification:
          lead.website_verification_status || "",
        Website_Candidates: Array.isArray(lead.candidate_websites)
          ? lead.candidate_websites
              .map((item: any) => item.url)
              .filter(Boolean)
              .join(" | ")
          : "",
        Contact_Status: lead.contact_status || "missing",
        Contact_Source: lead.contact_source || "",
        Discovery_Source: Array.isArray(lead.sources)
          ? lead.sources.join(", ")
          : lead.source || "",
        Potential_Website_Prospect: Boolean(
          lead.is_potential_website_prospect
        ),
        Research_Status: lead.research_status || "",
      }));

      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      const workbook = XLSX.utils.book_new();

      XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        "Business Leads"
      );

      // Improve spreadsheet column widths.
      worksheet["!cols"] = [
        { wch: 28 },
        { wch: 25 },
        { wch: 30 },
        { wch: 18 },
        { wch: 28 },
        { wch: 35 },
        { wch: 20 },
        { wch: 22 },
        { wch: 45 },
        { wch: 25 },
        { wch: 20 },
        { wch: 25 },
        { wch: 24 },
        { wch: 18 },
      ];

      const excelData = XLSX.write(workbook, {
        bookType: "xlsx",
        type: "array",
      });

      const blob = new Blob([excelData], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const downloadName = `leadpilot-leads-${Date.now()}.xlsx`;
      const newFileUrl = URL.createObjectURL(blob);

      setLeads(rows);
      setSummary({
        total_leads: data.total_leads ?? rows.length,
        osm_leads_found: data.osm_leads_found ?? 0,
        web_discovery_leads_found:
          data.web_discovery_leads_found ?? 0,
        researched_leads: data.researched_leads ?? 0,
        website_candidates: data.website_candidates ?? 0,
        businesses_with_website_listed:
          data.businesses_with_website_listed ?? 0,
        potential_website_prospects:
          data.potential_website_prospects ?? 0,
        prospects_with_contact_details:
          data.prospects_with_contact_details ?? 0,
        prospects_missing_contact_details:
          data.prospects_missing_contact_details ?? 0,
        search_location: data.search_location || location,
      });

      setFileName(downloadName);
      setFileUrl(newFileUrl);

      setState("success");
      setMessage(
        `Found ${rows.length} businesses in ${
          data.search_location || location
        }.`
      );
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

    return leads.filter((lead) => {
      const matchesView =
        leadView === "all" ||
        (leadView === "prospects" &&
          lead.is_potential_website_prospect === true) ||
        (leadView === "candidates" &&
          lead.website_status === "candidate_found") ||
        (leadView === "websites" &&
          lead.website_status === "found");

      const candidateUrls = Array.isArray(lead.candidate_websites)
        ? lead.candidate_websites
            .map((item: any) => item.url || "")
            .join(" ")
        : "";

      const searchableText = [
        lead.business_name,
        lead.name,
        lead.business_type,
        lead.location,
        lead.search_location,
        lead.phone,
        lead.email,
        lead.website,
        lead.website_status,
        lead.contact_status,
        lead.source,
        candidateUrls,
      ]
        .map((value) => String(value ?? ""))
        .join(" ")
        .toLowerCase();

      return matchesView && (!query || searchableText.includes(query));
    });
  }, [leads, filter, leadView]);

  function downloadExcel() {
    if (!fileUrl) return;

    const anchor = document.createElement("a");
    anchor.href = fileUrl;
    anchor.download = fileName || "leadpilot-business-leads.xlsx";

    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  }

  const isLoading = state === "loading";

  return (
    <main>
      <nav className="nav shell">
        <a className="brand" href="#" aria-label="LeadPilot home">
          <span className="brand-mark">
            <RadarIcon />
          </span>
          <span>
            Lead<span className="brand-accent">Pilot</span>
          </span>
        </a>

        <div className="nav-right">
          <span className="nav-status">
            <i /> Lead discovery workspace
          </span>

          <a className="nav-link" href="#how-it-works">
            How it works <span>↗</span>
          </a>
        </div>
      </nav>

      {/* HERO AND SEARCH FORM */}
      <section className="hero shell">
        <div className="hero-copy">
          <div className="eyebrow">
            <span className="eyebrow-line" />
            BUSINESS LEAD DISCOVERY, SIMPLIFIED
          </div>

          <h1>
            Find businesses.
            <br />
            <em>Start conversations.</em>
          </h1>

          <p className="hero-description">
            Discover businesses in any niche, identify potential
            website-development prospects, and collect publicly
            listed contact details. Turn your next market search
            into an actionable lead list.
          </p>

          <div className="trust-row">
            <span>
              <CheckIcon /> Location-based discovery
            </span>
            <span>
              <CheckIcon /> Website research
            </span>
            <span>
              <CheckIcon /> Excel export
            </span>
          </div>

          <div className="hero-note">
            <span className="note-icon">
              <SparkIcon />
            </span>

            <span>
              <strong>Less searching, more connecting.</strong>
              <br />
              One search creates a focused list for your outreach.
            </span>
          </div>
        </div>

        {/* SEARCH CARD */}
        <div className="form-card" id="search">
          <div className="form-card-top">
            <div>
              <div className="card-kicker">NEW SEARCH</div>
              <h2>Build your lead list</h2>
              <p>Tell us who you want to find.</p>
            </div>

            <div className="form-icon">
              <SearchIcon />
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <label htmlFor="businessType">
              What type of business?
            </label>

            <div className="input-wrap">
              <StoreIcon />

              <input
                id="businessType"
                name="businessType"
                placeholder="e.g. Solar installers, dentists, cafés..."
                value={businessType}
                onChange={(event) =>
                  setBusinessType(event.target.value)
                }
                required
                minLength={2}
                maxLength={100}
                disabled={isLoading}
              />
            </div>

            <div
              className="suggestions"
              aria-label="Business type suggestions"
            >
              {[
                "Dental clinics",
                "Shoe stores",
                "Solar installers",
                "Wedding planners",
                "Hair salons",
                "Restaurants",
              ].map((item) => (
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

            <label htmlFor="location">
              Where should we search?
            </label>

            <div className="input-wrap">
              <PinIcon />

              <input
                id="location"
                name="targetLocation"
                placeholder="City, region or country"
                value={location}
                onChange={(event) =>
                  setLocation(event.target.value)
                }
                required
                minLength={2}
                maxLength={200}
                disabled={isLoading}
              />
            </div>

            <label htmlFor="maximumLeads">
              Maximum number of leads
            </label>

            <div className="input-wrap select-wrap">
              <UsersIcon />

              <select
                id="maximumLeads"
                name="maximumLeads"
                value={maximumLeads}
                onChange={(event) =>
                  setMaximumLeads(event.target.value)
                }
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

            <button
              className="submit-button"
              type="submit"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner" />
                  Finding your leads...
                </>
              ) : (
                <>
                  Find business leads <ArrowIcon />
                </>
              )}
            </button>

            <p className="form-footnote">
              <LockIcon />
              Your search details are used to run this search.
            </p>
          </form>

          {state !== "idle" && (
            <div
              className={`result-message ${state}`}
              role="status"
              aria-live="polite"
            >
              <span className="result-symbol">
                {state === "loading" ? (
                  <span className="spinner dark" />
                ) : state === "success" ? (
                  <CheckIcon />
                ) : (
                  <AlertIcon />
                )}
              </span>

              <span>
                <strong>
                  {state === "success"
                    ? "Search complete"
                    : state === "error"
                    ? "Search needs attention"
                    : "Working on your search"}
                </strong>

                <small>{message}</small>
              </span>
            </div>
          )}
        </div>
      </section>

      {/* RESULTS DASHBOARD */}
      {state === "success" && leads.length > 0 && (
        <section
          className="shell lead-results"
          id="lead-results"
        >
          <div className="results-heading">
            <div>
              <div className="eyebrow">YOUR SEARCH RESULTS</div>
              <h2>Your business leads</h2>

              <p>
                {summary?.total_leads ?? leads.length} businesses
                discovered in{" "}
                {summary?.search_location || location}.
              </p>
            </div>

            <button
              className="submit-button download-button"
              type="button"
              onClick={downloadExcel}
              disabled={!fileUrl}
            >
              <FileIcon /> Download Excel
            </button>
          </div>

          {/* SUMMARY CARDS */}
          <div className="lead-summary-grid">
            <article className="lead-summary-card">
              <span>Total businesses</span>
              <strong>
                {summary?.total_leads ?? leads.length}
              </strong>
            </article>

            <article className="lead-summary-card prospect-summary">
              <span>Potential website prospects</span>
              <strong>
                {summary?.potential_website_prospects ?? 0}
              </strong>
            </article>

            <article className="lead-summary-card">
              <span>Website candidates</span>
              <strong>
                {summary?.website_candidates ?? 0}
              </strong>
            </article>

            <article className="lead-summary-card">
              <span>Prospects with contact details</span>
              <strong>
                {summary?.prospects_with_contact_details ?? 0}
              </strong>
            </article>
          </div>

          {/* DISCOVERY SOURCES */}
          <div className="lead-source-note">
            <strong>Discovery sources:</strong>

            <span>
              OpenStreetMap: {summary?.osm_leads_found ?? 0}
            </span>

            <span>
              Web discovery:{" "}
              {summary?.web_discovery_leads_found ?? 0}
            </span>

            <span>
              Research completed:{" "}
              {summary?.researched_leads ?? 0}
            </span>
          </div>

          {/* FILTERS AND SEARCH */}
          <div className="results-toolbar">
            <div className="lead-filter-buttons">
              {(
                [
                  ["all", "All leads"],
                  ["prospects", "No website found"],
                  ["candidates", "Website candidates"],
                  ["websites", "Website listed"],
                ] as [LeadView, string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`lead-filter-button ${
                    leadView === value ? "active" : ""
                  }`}
                  onClick={() => setLeadView(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="results-count">
              <strong>{filteredLeads.length}</strong> matching leads
            </div>

            <input
              className="results-search"
              type="search"
              placeholder="Search business, phone, email..."
              aria-label="Search leads"
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value)
              }
            />
          </div>

          {/* BUSINESS TABLE */}
          <div className="table-container">
            <table className="leads-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Location</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Website status</th>
                  <th>Website / candidates</th>
                  <th>Contact status</th>
                  <th>Discovery source</th>
                </tr>
              </thead>

              <tbody>
                {filteredLeads.map((lead, index) => {
                  const candidates = Array.isArray(
                    lead.candidate_websites
                  )
                    ? lead.candidate_websites
                    : [];

                  const isProspect =
                    lead.is_potential_website_prospect === true;

                  const websiteStatus =
                    lead.website_status || "not_checked";

                  return (
                    <tr
                      key={
                        lead.osm_id ||
                        `${lead.business_name || lead.name}-${index}`
                      }
                      className={
                        isProspect ? "prospect-row" : ""
                      }
                    >
                      <td>
                        <strong>
                          {lead.business_name ||
                            lead.name ||
                            "Unnamed business"}
                        </strong>

                        {isProspect && (
                          <span className="lead-status-badge prospect-badge">
                            Potential prospect
                          </span>
                        )}
                      </td>

                      <td>
                        {lead.location ||
                          lead.search_location ||
                          "—"}
                      </td>

                      <td>
                        {lead.phone ? (
                          <a href={`tel:${lead.phone}`}>
                            {lead.phone}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td>
                        {lead.email ? (
                          <a href={`mailto:${lead.email}`}>
                            {lead.email}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td>
                        <span
                          className={`lead-status-badge ${
                            websiteStatus === "not_found"
                              ? "prospect-badge"
                              : websiteStatus ===
                                "candidate_found"
                              ? "candidate-badge"
                              : websiteStatus === "found"
                              ? "website-badge"
                              : ""
                          }`}
                        >
                          {String(websiteStatus).replace(
                            /_/g,
                            " "
                          )}
                        </span>

                        {lead.website_verification_status ===
                          "unverified" && (
                          <small className="verification-note">
                            Not ownership-verified
                          </small>
                        )}
                      </td>

                      <td>
                        {lead.website ? (
                          <a
                            href={lead.website}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open website ↗
                          </a>
                        ) : candidates.length > 0 ? (
                          <div className="candidate-links">
                            {candidates.map(
                              (candidate: any, candidateIndex: number) => (
                                <a
                                  key={`${candidate.url}-${candidateIndex}`}
                                  href={candidate.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  {candidate.title ||
                                    "Possible website"}{" "}
                                  ↗
                                </a>
                              )
                            )}
                          </div>
                        ) : (
                          "No website identified"
                        )}
                      </td>

                      <td>
                        {String(
                          lead.contact_status || "missing"
                        ).replace(/_/g, " ")}
                      </td>

                      <td>
                        {Array.isArray(lead.sources)
                          ? lead.sources.join(", ")
                          : lead.source || "—"}
                      </td>
                    </tr>
                  );
                })}

                {filteredLeads.length === 0 && (
                  <tr>
                    <td colSpan={8} className="empty-results">
                      No matching leads found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="table-note">
            Scroll horizontally to see all columns. Website
            candidates are unverified. “No website identified”
            means the search did not find a plausible website; it
            does not prove the business has no website.
          </p>
        </section>
      )}

      {/* HOW IT WORKS */}
      <section className="metrics shell" id="how-it-works">
        <div className="metrics-heading">
          <span className="eyebrow">
            A CLEARER WAY TO PROSPECT
          </span>

          <h2>From search to spreadsheet.</h2>

          <p>
            Your search is processed by the connected
            lead-discovery workflow.
          </p>
        </div>

        <div className="steps">
          <article className="step">
            <span className="step-number">01</span>
            <div className="step-icon">
              <CompassIcon />
            </div>
            <h3>Discover</h3>
            <p>
              Search for businesses in your chosen niche and
              location.
            </p>
          </article>

          <article className="step">
            <span className="step-number">02</span>
            <div className="step-icon">
              <ShieldIcon />
            </div>
            <h3>Check</h3>
            <p>
              Research website candidates and publicly listed
              contact details.
            </p>
          </article>

          <article className="step">
            <span className="step-number">03</span>
            <div className="step-icon">
              <FileIcon />
            </div>
            <h3>Export</h3>
            <p>
              View your results online or download the Excel
              spreadsheet.
            </p>
          </article>
        </div>
      </section>

      {/* DISCLAIMER */}
      <section className="disclaimer shell">
        <span className="disclaimer-icon">
          <InfoIcon />
        </span>

        <p>
          <strong>A note on accuracy:</strong> “No website
          identified” means the search did not find a plausible
          website in the sources checked. It does not prove that a
          business has no website. Website candidates are
          unverified, and contact details should be checked before
          outreach.
        </p>
      </section>

      {/* FOOTER */}
      <footer className="footer shell">
        <a className="brand footer-brand" href="#">
          <span className="brand-mark">
            <RadarIcon />
          </span>

          <span>
            Lead<span className="brand-accent">Pilot</span>
          </span>
        </a>

        <span>Business discovery, made more focused.</span>

        <span>© {new Date().getFullYear()} LeadPilot</span>
      </footer>
    </main>
  );
}

/* ICONS */

function RadarIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.4" />
      <path d="M12 12 19 5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 4.5 4.5" />
    </svg>
  );
}

function StoreIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 10.5 4.5 4h15l1.5 6.5M5 10.5V20h14v-9.5M3 10.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M9 20v-5h6v5" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" />
      <circle cx="12" cy="10" r="2.2" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4V20M9.5 10.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM17 11a3 3 0 1 0-1-5.8M17 14.5h.5a3.5 3.5 0 0 1 3.5 3.5v2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m7 10 5 5 5-5" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12h14m-6-6 6 6-6 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 1 1 8 0v3" />
    </svg>
  );
}

function SparkIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2ZM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z" />
    </svg>
  );
}

function CompassIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4 5.4-2.2Z" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z" />
      <path d="m8.5 12 2.2 2.2 4.8-4.8" />
    </svg>
  );
}

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M13 2v7h7M8 13h8M8 17h8" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5m0-8h.01" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 2.8 20h18.4L12 3Z" />
      <path d="M12 9v4m0 3h.01" />
    </svg>
  );
}
