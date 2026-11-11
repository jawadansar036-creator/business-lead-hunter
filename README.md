# LeadPilot — Business Lead Hunter website

A responsive Next.js website for your Business Lead Hunter n8n workflow. The frontend is complete; the only integration point is the server-side n8n webhook.

## What is included

- Professional responsive landing page and search form
- Free-text business type and target location
- Maximum lead selector
- Loading, success and error states
- Excel file download when n8n returns the XLSX binary
- Server-side webhook proxy: the n8n URL and optional shared secret are not exposed in browser code

## 1. Run locally

Requirements: Node.js 20.9+.

```bash
npm install
cp .env.example .env.local
```

Open `.env.local` and set:

```env
N8N_WEBHOOK_URL=https://YOUR-N8N-HOST/webhook/YOUR-WEBHOOK-PATH
N8N_SHARED_SECRET=
```

Then:

```bash
npm run dev
```

Open http://localhost:3000.

## 2. Connect n8n

Your current workflow starts with **On form submission**. For the website, create a production webhook entry point:

1. In n8n, duplicate your working workflow first. Keep the original form-triggered workflow as a backup.
2. In the duplicate, add a **Webhook** trigger. Set method to `POST` and path to a hard-to-guess value.
3. Set the Webhook node response mode to **Using Respond to Webhook node**.
4. Connect the Webhook trigger to the same downstream lead-search steps that currently follow your form trigger.
5. Update references to `On form submission` in your expressions/code so they read the Webhook node's input fields. The website sends this JSON body:

```json
{
  "Business Type": "Shoe Stores",
  "Target Location": "Lahore, Pakistan",
  "Maximum Leads": 100
}
```

For example, in Code nodes use the incoming item (`$input.first().json`) or reference the new Webhook node, as appropriate. In the Overpass query expression, replace:

```js
const form = $('On form submission').first().json;
```

with:

```js
const form = $('Webhook').first().json.body ?? $('Webhook').first().json;
```

Use your actual Webhook node name if different. Confirm the exact payload in a test execution before changing other expressions.

6. Ensure the workflow's final XLSX file is available as binary data (for example, from **Convert to File**).
7. Add a **Respond to Webhook** node after the XLSX creation step. Set it to return the binary property produced by Convert to File (often `data`; confirm the property name in the node output). Set the response header `Content-Disposition` to `attachment; filename="business-leads.xlsx"` and the MIME type to `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
8. Activate the workflow and copy its **Production URL**, not the test URL.

### Optional shared-secret protection

Set `N8N_SHARED_SECRET` in the website hosting environment and configure the n8n workflow to verify the incoming `x-lead-hunter-token` header before running. Do not place this secret in frontend code. If you do not implement a verification step in n8n, leave this variable empty.

## 3. Deploy on Vercel

1. Push this project to a private GitHub repository.
2. Import that repository at https://vercel.com/new.
3. In Vercel project settings, add environment variable `N8N_WEBHOOK_URL` with your n8n Production URL. Optionally add `N8N_SHARED_SECRET` if you configured it in n8n.
4. Deploy. Redeploy after changing environment variables.

## Important integration notes

- The website sends `Business Type`, `Target Location`, and `Maximum Leads` as JSON fields with the same labels used by your n8n form.
- The API route expects n8n to return the XLSX file itself as the HTTP response body. If n8n returns JSON, the site displays a configuration error rather than downloading a misleading file.
- The route waits up to about 4 minutes 40 seconds. Some hosting plans or n8n configurations may impose shorter request limits. If searches take longer, switch to an asynchronous pattern: return a job ID immediately, poll for status, and download the completed file from a separate endpoint.
- Add authentication, rate limiting, abuse protection and a privacy notice before opening the site to the public. A public form can trigger workflow runs and consume Tavily/Overpass resources.
- “No independent website found” is not proof that a business has no website. Keep that qualification in the product wording.

## Project structure

```text
app/
  api/leads/route.ts   Server-side n8n proxy
  globals.css          Complete visual styling
  layout.tsx           Metadata and root layout
  page.tsx             Landing page and search form
.env.example           Server-only environment variable template
```
