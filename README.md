# EDU Test Manager

The **Slice exams** task lets you choose a scanned PDF and output folder in Google Drive, detect QR-marked front pages, review the groups, and save a separate PDF for each exam.

Built with Vite, TypeScript and Bootstrap, following [playground_googledrive_filepicker](https://github.com/twyleg/playground_googledrive_filepicker). Google Identity Services handles sign-in; Google Picker selects PDFs and folders in My Drive or shared drives. PDF.js renders pages for jsQR detection, and pdf-lib copies the original pages into the output files. There is no application backend.

## Run locally

Use Node.js 22.13+ (or a newer supported LTS release).

```bash
npm install
cp .env.example .env
# Fill in your Google Cloud values in .env.
npm run dev
```

Open http://localhost:8080. Without Google credentials, you can still choose a local PDF, detect front pages, adjust the split points, preview, and download the resulting files. Google Drive selection and upload require the configuration below.

## Google Cloud configuration

In the same Google Cloud project:

1. Enable **Google Drive API**, **Google Picker API**, and **Gmail API**.
2. Configure the OAuth consent screen. While the application is in testing, add your Google account as a test user. Add the scope `https://www.googleapis.com/auth/drive.file` for slicing. For the matching task, also configure `https://www.googleapis.com/auth/drive`: users grant this broader scope explicitly using **Enable folder access**. For Prepare drafts, also configure `https://www.googleapis.com/auth/gmail.compose`; users grant it explicitly with **Enable Gmail drafts**. Google may require additional verification for publicly deployed apps using these restricted scopes.
3. Create an OAuth 2.0 client of type **Web application**. Add `http://localhost:8080` and `http://127.0.0.1:8080` as authorized JavaScript origins. The GIS token flow does not require a redirect URI or a client secret.
4. Create an API key. Restrict it to the Google Picker API and Google Drive API. Under website restrictions, allow the application’s HTTP referrers (for development, `http://localhost:8080/*` and `http://127.0.0.1:8080/*`) and `https://docs.google.com/*`, where Google hosts the Picker iframe. See [Google’s API-key configuration instructions](https://developers.google.com/workspace/drive/picker/guides/web-picker#create_an_api_key).
5. Find the numeric **project number** in Google Cloud project settings; this is the Picker app ID.
6. Fill in `.env`:

```dotenv
VITE_GOOGLE_CLIENT_ID=your-oauth-client-id.apps.googleusercontent.com
VITE_GOOGLE_API_KEY=your-google-api-key
VITE_GOOGLE_APP_ID=your-google-cloud-project-number
```

Restart Vite after changing these values. They are public browser configuration, not server secrets; never put an OAuth client secret in a `VITE_` variable. The HTML entry point and Vite environment files are at the repository root.

For deployment, run `npm run build`, host `dist/` on HTTPS, add the production origin to the OAuth client and update the API key’s allowed referrers. Serve the bundled PDF.js worker as a JavaScript module. Also serve `google-picker-relay.html` as a static HTML file on the app’s origin; do not redirect it to sign-in or rewrite it to the app entry point. Picker uses this empty page for its parent-side messaging relay instead of its default `/favicon.ico` URL. `npm run preview` serves the production build locally; authorize that origin too if testing Google sign-in there.

## Tasks and subtasks

The application has three independent **Tasks**, shown as tabs. They are entry points, not mandatory sequential steps:

- **Slice exams**: split a combined scan into individual exam PDFs. This task is implemented and can be completed without matching students or preparing email drafts.
- **Match students**: start directly with a Google Drive folder containing already-sliced exams and a student CSV list. Match exams to students using their handwritten names. Slicing need not happen in the same session or in this application.
- **Prepare drafts**: start with renamed exam PDFs and the student CSV, expand a message template, then create Gmail drafts with real PDF attachments for manual review. Nothing is sent by the app.

Each task loads its own inputs. Matching reuses the slicing folder initially; drafting reuses the matching folder and CSV initially. Switching tabs preserves each in-memory batch. After reloading, select the matching folder and CSV again; existing student filenames are recognized without renaming them automatically.

Actions within a task are called **Subtasks**. Slice exams has three vertically stacked, foldable subtasks:

1. **Choose files & scan**: choose the combined PDF, destination folder and scan settings, then scan.
2. **Review the split**: inspect the candidate exams, correct front pages and prepare individual PDFs.
3. **Save individual PDFs**: preview, download or save the prepared files to Drive.

During downloading, scanning, preparation or upload, the active banner is muted and a floating progress island at the bottom of the viewport receives focus. It stays visible while scrolling, then returns to an inline status message when processing ends. Drive downloads first request the PDF size from Drive metadata, then show a growing bar and percentage based on received bytes—even when the download response omits Content-Length. If neither metadata nor response headers provide a usable size, an activity bar and received-byte count remain the fallback. Downloads can be cancelled with Cancel scan. Successful completion folds that subtask and opens the next; after saving to Drive, the final subtask folds with its saved-file count in the header. Completed panels can be reopened to inspect their contents. Errors and cancellation keep the relevant panel open for correction or retry. Unavailable subtasks remain folded until their inputs exist. Starting a new batch returns to the first subtask.

## Slice exams workflow

1. Connect Google Drive and choose the combined **PDF**. The picker opens with a PDF-wide listing across folders; use Google’s date sorting to find recent scans. My Drive root browsing and Shared drives are also available. Google controls the listing order; the app does not use the deprecated `RECENTLY_PICKED` view or keep a separate recent-files history.
2. Choose a writable **output folder**. In Picker, single-click the folder row and click **Select**. Double-clicking opens the folder; to select that folder, return to its parent and select its row. Folder selection and downloads support shared drives subject to your Google account’s permissions.
   - To sort alphabetically, click Picker’s **Name** column. Google Picker has no supported API for forcing a default sort order.
   - After connecting Drive, click **New folder** beside the selector to create a folder inside the selected directory, or in My Drive when no directory is selected. Enter its name and click **Create folder**; the new folder becomes the output destination. Creation is disabled after uploads begin.
3. Click **Scan PDF**. Only the full-width top 20% of each page is rendered for QR detection, with a higher-resolution retry for small codes. **Scan threads** defaults to 2 and accepts 1–8: independent Web Workers decode QR codes concurrently while PDF.js renders pages. Higher counts use more memory and may not be faster on every device. Full-page thumbnails are rendered separately at low resolution. The QR payload is never used or stored. Scan progress is shown and scanning can be cancelled.
4. Review the page thumbnails. Each candidate exam has its own row with a page range; long rows scroll horizontally. Front-page checkbox changes immediately split or merge the rows. The magnifier beside each checkbox opens a detailed full-page view; close it with **Close** or **Escape**. Each checked **Front page** begins an exam; subsequent pages belong to that exam until the next checked page. Correct any missed or unwanted markers. No-marker scans and unmarked leading pages require correction, so no pages are silently dropped.
   - **Skip page** omits a page from the output while keeping its preview dimmed. Front pages cannot be skipped; marking a skipped page as a front page includes it again.
   - **Rotate left/right** changes a page in 90° increments, including its enlarged preview and output PDF. Existing PDF rotation is preserved and combined with the edit.
   - Drag continuation pages onto another continuation page within the same exam to reorder them, or use the earlier/later arrow buttons (also available on touch screens and with a keyboard). Front pages remain first; moving between exams is not allowed. Preview page numbers always identify original source pages.
   - Edits invalidate prepared PDFs. Prepare them again to apply changes. All editing is locked once uploads begin. Edits remain in memory only; the source PDF is never changed.
5. Click **Prepare PDFs** to copy the page groups into individual files. Preview or download them before uploading. Your chosen order, inclusion and rotation are applied; original page dimensions and contents are preserved; output PDFs are not screenshots.
6. Click **Save PDFs to Drive**. Files are created in the selected folder with names such as `Physics_exam-001_pages-1-2.pdf`. The original input is not modified. Each uploaded file gets a link to Drive.

If upload fails, reconnect if required and click **Retry remaining uploads**. Successful files are skipped. Pre-generated Drive file IDs let retries check for a completed upload even if its response was lost. Once uploads begin, the input, split points and destination stay fixed; use **Start a new batch** to begin another run. A new batch creates new files even if the same names already exist in Drive.

## Match students workflow

1. Open **Match students**. Its exam folder is initially prefilled from the slicing destination, if one is available; otherwise choose any Drive folder containing individual exam PDFs.
2. Choose a **student CSV** from Drive. The example in `resources/example_student_list.csv` uses a UTF-8 BOM and semicolons. Required headers are `Nr.`, `Nachname`, `Vorname`, and `E-Mail-Adresse`; other columns are available as placeholders when preparing drafts. Comma delimiters, quoted fields and Windows-1252 exports are also supported.
3. Click **Enable folder access** if requested. The slicing task's `drive.file` scope does not grant access to all existing children of a selected folder. Matching therefore requests broader Drive access explicitly, so exams from earlier sessions or other tools can be listed and renamed. See [Google's scope reference](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
4. Click **Find exams & students**. The setup subtask folds and **Select exam files** opens with all PDFs directly in that folder checked by default. Uncheck files to exclude them, or use **Select all** / **Select none**. Listing includes all result pages and does not download the exam PDFs. Click **Download & start matching** to preload only the selected PDFs and render their name previews; the selection panel then folds and **Match students & rename** opens. Progress and cancellation are available during preloading. Moving between exams uses this in-memory cache, without downloading again. Subfolders and non-PDFs are excluded.
5. Inspect the right half of the front page's top quarter. **View full front page** shows the rest if handwriting falls outside this area. Type a first or last name in **Student** and choose a suggestion. Suggestions include the student number and email address. Tab completes the name when only one matching student remains; ambiguous queries are not completed. Once a student is selected, Enter performs **Rename & next**; no OCR or automatic handwriting assignment is used.
6. Check the proposed filename and click **Rename & next**. This immediately renames the existing Drive file to `Nr_Nachname_Vorname.pdf`, preserving spelling and umlauts (for example `01_Müller_Anna.pdf`). Characters unsuitable for filenames are replaced with hyphens. PDF contents, file IDs and folder location stay unchanged.
7. Continue with the next unmatched selected exam. After the final match, the matching panel folds automatically and a completion message appears below it. Reopen its banner to review any exam. All three subtask banners remain visible, with unavailable panels folded and disabled. **Previous** and **Next / skip for now** let you revisit pages. Already-named files are recognized by exact filename; this is not proof that the handwritten name is correct, so they remain reviewable.

The `Nr.` column must contain unique numeric student numbers; filename numbers are padded to at least two digits (1 becomes 01). Existing leading zeros and numbers longer than two digits are preserved. Students with identical names are distinguished by their numbers. Before each rename the folder is checked again for a conflicting PDF name; existing PDFs are never overwritten. Drive does not offer an atomic unique-filename constraint, so concurrent changes from another app can still introduce duplicates. A retry after a lost rename response recognizes the completed rename. Errors leave the current exam available for retry or another choice.

The CSV, all exam PDFs and all name previews are kept in browser memory until the matching inputs change, reload, or disconnect. Large folders therefore require enough browser memory. Cancelled or failed preloads release the partial cache and leave file selection open for retry. Changing the checked files clears the prepared previews and requires preloading again; completed Drive renames are preserved. Renamed filenames persist in Drive; no matching spreadsheet or student metadata is uploaded. Reloading requires selecting the folder and CSV again. Email addresses are read for matching context and future draft work; no email is sent or drafted by the matching task.

## Prepare drafts workflow

1. Open **Prepare drafts**. The folder and CSV are prefilled from Match students when available, or can be selected independently. Filenames must match the padded `NR_NACHNAME_VORNAME.pdf` names derived from the CSV.
2. Click **Enable Gmail drafts** to authorize `gmail.compose` and access to the exam folder. Gmail API must be enabled in your Google Cloud project. Google's scope includes sending permission, but this app exposes only draft creation and lookup: it never calls a send endpoint.
3. Click **Load recipients & exams**. The app reads the Gmail account, CSV and folder listing. It selects PDFs with an exact filename match and a valid student email. Unmatched names, duplicate PDF names and missing/invalid addresses are shown as issues and cannot be selected. Other valid PDFs may be unchecked.
4. Write subject and plain-text body templates. Placeholders use CSV column headers, such as `{{Vorname}}`, `{{Nachname}}`, `{{Nr.}}`, `{{E-Mail-Adresse}}`, or additional columns like `{{Klasse}}`. Unknown or incomplete placeholders are rejected. There is no code execution, HTML formatting, conditionals or loops.
5. Optional comma-separated **subject tags**, such as `8A, Informatik`, produce `[8A] [Informatik]` at the start of each subject. These are searchable subject text, not Gmail labels. The [Gmail API does not allow custom labels on draft messages](https://developers.google.com/workspace/gmail/api/guides/labels).
6. Click **Preview drafts** and review every recipient, personalized subject/body and attachment filename. Then click **Create drafts in Gmail**. Each selected PDF is downloaded and attached as `application/pdf` using MIME attachment encoding; no Drive sharing link is substituted. Attachments are limited to 25 MB per PDF.
7. Completed drafts appear in Gmail's Drafts folder for manual checks and sending. The final panel folds automatically when the batch completes. The app displays the account used; if Gmail opens another account, switch to the displayed account.

Once creation starts, folder, recipients and templates are locked for consistent retries. Successfully created drafts are skipped when resuming. **Stop after this draft** finishes the in-flight operation without starting another. An ambiguous creation response is reconciled by searching for the draft's unique Message-ID; if Gmail cannot confirm it, the app stops instead of risking a duplicate. Keep this tab open: retry tracking is in memory, and reloading then creating another batch can create duplicate drafts. Search indexing can delay confirmation after a lost response. If it cannot be confirmed, check Gmail manually before starting a new batch; abandoning an incomplete batch asks for confirmation because its retry tracking will be discarded. PDFs in Drive are neither renamed nor modified by this task.

## Data and limitations

If Picker opens but clicking **Select** does nothing, check `VITE_GOOGLE_APP_ID` first: it must be the numeric **project number**, not the textual project ID or project name. The project number, OAuth client and API key must belong to the same Google Cloud project. Restart the development server after changing `.env`, reload the page, and reconnect Google Drive. The app validates the project number format before opening Picker.

If it still fails, open the browser’s developer console before clicking **Select**. The app logs `[Drive Picker]` lifecycle events without tokens, file IDs or filenames. An `Opening` event followed by `loaded`, but no `picked` callback after selection, indicates that Google’s iframe has not delivered the selection to the app. A `Selection accepted` event means the app handled the selected item. Check for accompanying console errors and failed Network requests; share only their hostname/path and status, never query strings, request bodies or authorization headers. Browser privacy settings or extensions can also affect embedded Google content, so compare with another browser to isolate a browser-specific failure. The app cannot read errors inside Google’s cross-origin iframe.

- PDF bytes, generated files and page previews remain in browser memory. Downloads/uploads go directly between the browser and Google Drive. Google-hosted Identity, Picker and font resources require network access.
- Slicing starts with the limited `drive.file` scope. Matching explicitly requests broader `drive` access to existing folder contents. Those tasks request no mailbox access. Prepare drafts separately requests `gmail.compose` to create and check drafts.
- Like the reference app, the short-lived access token is cached in `sessionStorage` with an expiry buffer. Disconnect clears/revokes the token and clears the current batch. No refresh token is stored.
- Keep the tab open during processing and upload retries. Reloading loses the batch, generated IDs, PDFs and retry state. Reprocessing after a reload can create another set of files.
- QR recognition depends on scan quality. Review the detected boundaries; every QR code counts as a potential front-page marker, including unrelated QR codes within the top 20%. Markers below that region (including upside-down scans) are not detected. Manual corrections are available for unreadable markers.
- Encrypted/password-protected or malformed PDFs are unsupported. Browser memory is the practical size limit for large scans; concurrency and raster resolution are bounded.
- Slicing names files by exam number and page range; matching renames them by student. Prepare drafts attaches the renamed files to personalized Gmail drafts.

OCR is not used as a prefilter: it would add text recognition work and could exclude genuine front pages when a keyword is misread. Only QR detection marks a page automatically; keywords alone never do.

## Verification

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

To use an existing Chromium/Chrome installation instead:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run test:e2e
```

For an opt-in timing run against the local sample, use `SCAN_BENCHMARK=1 npm run test:e2e -- benchmark.spec.ts` (with the browser executable environment variable above if needed). It reports scan times for 1, 2 and 4 workers; PDF import and file transfer are outside the timer.

Unit tests cover grouping, leading-page handling, naming, Drive permissions, token expiry and retry-safe uploads. Browser tests exercise actual PDF rendering/detection/splitting, manual corrections, and a simulated Google Picker/Drive workflow. The sample-PDF test runs with `resources/example_lzk.pdf` (or the legacy root filename `20260911_142302_005443.pdf`); PDFs are ignored by Git to avoid committing student scans. Live Google OAuth and upload still need a manual check with your project credentials.

## Source map

- `src/main.ts`: workflow state, progress and event coordination.
- `src/matching.ts`, `src/students.ts`: independent matching workflow and CSV parsing.
- `src/drafts.ts`, `src/draftPlan.ts`: draft workflow, file-to-student validation and preview.
- `src/email.ts`, `src/gmail.ts`: MIME attachment encoding and Gmail draft-only API calls.
- `src/googleDrive.ts`: OAuth, Picker, downloads, folder validation and uploads.
- `src/pdf.ts`: bounded concurrent page rendering and lossless page copying.
- `src/qrScanner.ts`, `src/qr.worker.ts`: transferable pixel buffers and background QR detection.
- `src/grouping.ts`: page range validation and output naming.
- `src/view.ts`, `src/styles/main.css`: accessible, responsive workflow UI.
- `tests/`: unit tests and browser integration tests.

API references: [Google Picker](https://developers.google.com/workspace/drive/picker/reference/picker.docsview), [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).
