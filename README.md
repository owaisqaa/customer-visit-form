# Customer visit reports

Arabic form for Leaders Of Grandness using the original logo, all 38 optional questions, and bundled Cairo font.

- One shared email/password login backed by Supabase Auth.
- Database-backed history, private shop photos, and browser-local drafts.
- Actual XLSX exports: all visits or an inclusive visit-date range.
- Import reports from the previous browser-only version without deleting the originals.
- Two-page A4 PDF with Arabic shaping and Safari-safe sharing.

## Finish Supabase setup

1. Open project `nflrbopsqpjqabnhwstb` in Supabase.
2. Under **Authentication > Users**, create and confirm your shared login account with your chosen email and password. Never put the password in GitHub or chat.
3. Disable **Allow new users to sign up** in Authentication settings.
4. Open **SQL Editor > New query**, paste the entire [supabase/setup.sql](supabase/setup.sql), replace `YOUR_LOGIN_EMAIL` with your login email **in the SQL Editor only**, and click **Run**. Keep the quotes around the email. Do not commit the filled-in SQL to GitHub. The script stops without applying changes if the account is missing or unconfirmed. Create/confirm it and rerun.
5. Set Authentication's **Site URL** to `https://leadersgroup.netlify.app`.
6. Wait for the GitHub-connected Netlify deployment, open the site, and log in.
7. Save a blank test visit, reopen/edit it, download its PDF, and test both Excel buttons. Check that the visit appears when logging in on another device.

The Project URL and publishable key are already configured in `dist/cloud.js`. No Netlify environment variables or build command are needed. Never add a service-role key, database password, or secret key to frontend files.

The SQL enables RLS. Only the approved authenticated user UUID can access its visits and photos. Knowing the publishable key or signing up with another email does not grant access. The allowlist resolves the confirmed account email to its UUID during setup, rather than trusting user-editable metadata.

## Netlify

Import this repository, branch `main`. Leave base directory and build command empty; publish directory is `dist`. The included `netlify.toml` sets this.

Netlify publishes only `dist`, not the SQL or tests. The link is public, but data requires Supabase login. Security headers in `dist/_headers` restrict scripts and connections to the app and its Supabase project.

## Data and history

Saved reports live in Supabase PostgreSQL; photos live in the private `visit-photos` Storage bucket. Reports are not saved in GitHub. The same login sees the same history on every device. Shared credentials cannot identify individual employees.

Drafts remain in IndexedDB on the current browser only. Cloud save requires internet and is confirmed separately. A failed save retains the draft and offers a PDF-only fallback. Version checks prevent silent overwrites from another device. Sessions survive reloads within the current tab using sessionStorage; closing the tab may require another login. Passwords are never stored by app code.

On shared devices, local drafts and legacy reports remain until browser data is cleared. Logout hides/clears rendered data; local storage is not encrypted against someone with access to that browser.

### Existing reports

On each browser containing old reports, open History and choose **استيراد التقارير القديمة من هذا الجهاز**. Existing IDs are skipped and local originals are preserved. This does not automatically import data from other devices. The old draft can be restored after confirmation.

### Excel

Ranges use the form's visit date, include both endpoints, and exclude undated visits. Export all includes undated visits and ignores active filters. Range export ignores the search term. All pages are fetched, not only the visible screen. Avoid edits/deletions during a large export: pagination is a live read, not a transaction snapshot.

The workbook contains all 38 fields plus ID, created time, and updated time (UTC). Ratings are numeric, preserving blank versus zero. Dates are sortable Excel dates. Text is literal, never interpreted as formulas. Photo links open the visit page and require login; they do not expose public storage URLs or expire like signed URLs.

The first tab, `الملخص`, summarizes exactly the exported visits (all or the selected date range). It includes completion for every field; answer counts and percentages for ratings, grades, yes/no and text categories; and rating averages out of 5 and as a percentage. Blank answers are separate; numeric zero counts in averages. Invalid rating values remain visible in the distribution but are excluded from averages. Notes, GPS and photos summarize presence only. Counts and category lists are a snapshot of the export; regenerate the workbook after changing visits. Percentage and average cells contain formulas with cached results.

The `الزيارات` tab uses compact widths, wrapped text, a frozen header, filters and content-based row heights. Long notes remain intact; rows are capped at 90 points for browsing and can be expanded or read in the formula bar. Values beyond Excel's 32767-character cell limit produce an error rather than silent truncation. Cairo is declared in workbook styles; Excel needs Cairo installed to display it. The webpage and PDF bundle the font.

Old/replaced photos remain private in Storage. Deleting a visit removes its database record but does not purge images, avoiding cross-resource deletion races. The owner can manage unused files/backups in Supabase. Excel is not a full backup of photo files. Monitor Supabase plan and storage limits.

## Fonts and PDF

Cairo Regular, Medium and Bold come from the supplied Cairo.zip. The webpage and PDF use the bundled family. PDF text is rendered at high resolution to preserve Arabic shaping and is not selectable.

Every PDF has two A4 pages: visit details/display materials on page 1; product scores/representative relationships on page 2. Text and spacing shrink for long answers without dropping questions. Very long notes produce smaller print.

On iPhone, generate the PDF, tap **Save or share PDF**, then **Save to Files**. The explicit download fallback targets another tab and keeps its blob URL alive for the originating document's lifetime. Closing the ready dialog does not clear answers/history.

Third-party licenses are included in `dist`. JSZip packages the browser-generated XLSX. The supplied logo remains its owner's property.

## Tests

Run `node --test tests/*.test.cjs` with Node.js 20 or later. Tests cover auth, refresh, account rejection, pagination, date boundaries, blank saves, version conflicts, XLSX data types and safe strings, and Safari PDF delivery.

`node tests/browser-flow.cjs` runs the browser suite with Playwright and Chromium installed. It mocks Supabase and writes no live records. `node tests/preview-server.cjs` serves local-only fake data at `http://localhost:4173/?mock=1`. These fixtures are not published.

Unit tests do not establish live Supabase/RLS or actual iPhone behavior. Complete the live smoke test above after running SQL.
