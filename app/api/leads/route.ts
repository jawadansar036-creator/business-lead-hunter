import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL;

  if (!webhookUrl) {
    return NextResponse.json(
      { error: "The n8n webhook has not been configured yet. Add N8N_WEBHOOK_URL to the server environment." },
      { status: 503 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Please submit valid search details." }, { status: 400 });
  }

  const data = body as {
    businessType?: unknown;
    targetLocation?: unknown;
    maximumLeads?: unknown;
  };

  const businessType = String(data.businessType ?? "").trim();
  const targetLocation = String(data.targetLocation ?? "").trim();
  const maximumLeads = Number(data.maximumLeads);

  if (!businessType || !targetLocation) {
    return NextResponse.json(
      { error: "Business type and target location are required." },
      { status: 400 }
    );
  }

  if (!Number.isInteger(maximumLeads) || maximumLeads < 1 || maximumLeads > 500) {
    return NextResponse.json(
      { error: "Maximum leads must be a whole number between 1 and 500." },
      { status: 400 }
    );
  }

  let endpoint: URL;
  try {
    endpoint = new URL(webhookUrl);
    if (endpoint.protocol !== "https:" && endpoint.hostname !== "localhost") {
      throw new Error("Webhook URL must use HTTPS.");
    }
  } catch {
    return NextResponse.json(
      { error: "The configured n8n webhook URL is invalid. Check your server environment." },
      { status: 500 }
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 280_000);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/octet-stream, application/json"
    };

    const sharedSecret = process.env.N8N_SHARED_SECRET;
    if (sharedSecret) headers["x-lead-hunter-token"] = sharedSecret;

    const upstream = await fetch(endpoint.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify({
        "Business Type": businessType,
        "Target Location": targetLocation,
        "Maximum Leads": maximumLeads
      }),
      cache: "no-store",
      signal: controller.signal
    });

    if (!upstream.ok) {
      const detail = (await upstream.text()).slice(0, 700);
      return NextResponse.json(
        { error: `The n8n workflow returned an error (${upstream.status}). ${detail || "Check the workflow execution in n8n."}` },
        { status: 502 }
      );
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    // If n8n responds with JSON, treat it as a configuration/status response,
    // not as an Excel file accidentally downloaded by the browser.
    if (contentType.includes("application/json")) {
      const result = await upstream.json().catch(() => null);
      if (result?.error) {
        return NextResponse.json({ error: String(result.error) }, { status: 502 });
      }
      return NextResponse.json(
        { error: "n8n responded with JSON instead of an Excel file. Configure the workflow's Respond to Webhook node to return the XLSX binary file." },
        { status: 502 }
      );
    }

    const file = await upstream.arrayBuffer();
    if (!file.byteLength) {
      return NextResponse.json({ error: "The workflow completed but returned an empty file." }, { status: 502 });
    }

    const upstreamName = upstream.headers.get("content-disposition") || "";
    const nameMatch = upstreamName.match(/filename="?([^";]+)"?/i);
    const filename = (nameMatch?.[1] || `business-leads-${Date.now()}.xlsx`)
      .replace(/[\r\n"]/g, "");

    return new NextResponse(file, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store"
      }
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return NextResponse.json(
      { error: timedOut
        ? "The search took too long for this request. Check the n8n execution; you may need an asynchronous job-and-download setup for longer searches."
        : "Could not connect to the n8n workflow. Check the webhook URL and that the workflow is active." },
      { status: 504 }
    );
  } finally {
    clearTimeout(timeout);
  }
}