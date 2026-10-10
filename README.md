# EDU Test Manager

The **Slice exams** task lets you choose a scanned PDF and output folder in Google Drive, detect QR-marked front pages, review the groups, and save a separate PDF for each exam.

Built with Vite, TypeScript and Bootstrap, following [playground_googledrive_filepicker](https://github.com/twyleg/playground_googledrive_filepicker). Google Identity Services handles sign-in; Google Picker selects PDFs and folders in My Drive or shared drives. PDF.js renders pages for jsQR detection, and pdf-lib copies the original pages into the output files. There is no application backend.

## Shared workflow inputs

Select the **Course directory** and **Student list file** in the topbar. Choose a scan PDF within **Import scans**. With remembering enabled in Privacy & storage settings, these selections are restored on the next visit. The student CSV picker also opens in the last student-list directory.

Choose **Current test** to resume a test inside the course's LZKs or Klausuren folders. Use **Create a new test** in that menu to enter a topic and type; the new test is selected automatically. Slice exams lists PDFs from its `02_Korrigiert` folder and selects `03_Split` as the destination. Match students uses `03_Split` and the shared CSV. Prepare emails offers **Preview drafts** from `04_Previews` or **Final drafts** from `03_Split`, using the same CSV; recipient review, email templates, and Gmail authorization remain available.

Click **Connect Google** in the header before using the tasks. It requests Drive, Gmail draft and Gmail label permissions together. Task tabs and workflow selections stay disabled until all permissions are granted; the connection control sits before the three selections. Refresh tests after adding corrected PDFs in Drive. Shared selections are locked during active operations and incomplete jobs so retry destinations stay stable.

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
2. Configure the OAuth consent screen. While the application is in testing, add your Google account as a test user. Configure the scopes `https://www.googleapis.com/auth/drive.file`, `https://www.googleapis.com/auth/drive`, `https://www.googleapis.com/auth/gmail.compose`, and `https://www.googleapis.com/auth/gmail.modify`. The header **Connect Google** button requests them together for the workflow. Google may require additional verification for publicly deployed apps using these restricted scopes.
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

The application has six independent **Tasks**, shown as tabs. **Import scans** opens by default. They are entry points, not mandatory sequential steps:

- **Import scans**: copy and rename a scanner PDF into the selected test’s `01_Scans` folder.
- **Slice exams**: split a combined scan into individual exam PDFs. This task is implemented and can be completed without matching students or preparing email drafts.
- **Match students**: start directly with a Google Drive folder containing already-sliced exams and a student CSV list. Match exams to students using their handwritten names. Slicing need not happen in the same session or in this application.
- **Create documentation**: review the matched exams in separate points and marks passes in the course directory’s `results.json`.
- **Batch send**: independently load drafts using the Gmail label `bulk-send`, select messages and send them explicitly.
- **Prepare emails**: start with renamed exam PDFs and the student CSV, expand a message template, then create Gmail drafts with real PDF attachments for manual review. This task does not send emails.

Each task loads its own inputs. Matching reuses the slicing folder initially; drafting reuses the matching folder and CSV initially. Switching tabs preserves each in-memory batch. After reloading, select the matching folder and CSV again; existing student filenames are recognized without renaming them automatically.

### Create documentation

Choose a course, current test and student list in the topbar, then open **Create documentation** after matching students. The **Load exams & results** subtask reads the matching input directory (normally `03_Split`) and matches the renamed PDFs to the shared student CSV. It folds after loading and opens the relevant entry subtask:

1. **Record points**: enter points for every student. Press **Enter** or **Confirm & next** to move to the next student locally, without waiting for a Drive write. After the last student, **Save points & start marks** saves the points pass and returns to the first student.
2. **Record marks**: enter marks for every student, with the recorded points displayed beside the field. Enter confirms and advances; **Save marks** saves the marks pass after the last student.

The active field receives focus automatically. If a student was skipped, finishing the pass returns to the first missing value. Each entry subtask has the same numbered, collapsible banner used by the other tasks. Finishing points folds that subtask and opens marks; finishing marks folds it and opens **Review & save results.json**. Reopen an entry banner to revisit its last student; Previous and Next retain entered values. **View full front page** provides additional context. Unmatched PDFs are listed for correction in Match students. An existing points-only file resumes in the marks pass.

Use **Set points highlight** or **Set grade highlight** below the preview to mark the relevant field once. Drag a rectangle around the field; the rest of the image is dimmed. The points and grade rectangles are independent and reused across this course’s exams. **Adjust** and **Remove highlight** let you change them. Keyboard configuration uses arrow keys to move, Shift + arrows to resize, Enter to apply and Escape to cancel. Rectangles scale with the preview, including on mobile. This uses a browser overlay with no OCR or additional PDF rendering. Coordinates are remembered per course when folder remembering is enabled; otherwise they stay in memory for the current session.

Open **Review & save results.json** at any time to edit, copy or save progress. **Save results.json** can save progress at any time. It writes a formatted file directly in the course directory. **Copy JSON** immediately copies the displayed content, including unsaved and partial entries. Points and marks remain text to preserve decimal commas and grade modifiers; an unentered field is an empty string:

The JSON text view is editable. Valid JSON edits immediately update the review fields and counts; editing the review fields updates the JSON too. **Save results.json** saves the edited document, including added or removed entries, and formats it with indentation. Invalid JSON or entries missing `points` or `mark` show an inline error and disable saving, copying and confirming a student until corrected. Unfinished editor text is retained when navigating or switching task tabs.

```json
{
  "Müller, Anna": {
    "points": "17,5",
    "mark": "2+"
  }
}
```

An existing `results.json` is loaded for continuation and updated in place. The student CSV supplies the surname/first-name boundary when migrating old keys such as `"Müller Anna"` to `"Müller, Anna"`, including compound surnames and multiple first names. Unknown entries are retained without guessing how to split their names. Conflicting old/new entries or ambiguous old names block saving until resolved. Entries for other students remain; saving another test replaces the saved points and mark for the same student because the file contains one entry per student, without a test-level grouping. Duplicate student names, duplicate matched PDF filenames and malformed existing results block saving. Unsaved entries lock shared selections and prompt before reloading or leaving the page. Retrying a failed save uses the same file ID and retains the active pass.

Match students and Create documentation share an in-memory course cache for PDF bytes and top-right previews. Renaming a PDF retains its cached content; a changed Drive content checksum triggers a fresh download and render. Documentation prefetches the next exam while you enter results, and advancing during that download reuses the same request. Previous/Next and the second pass reuse cached previews. The cache retains up to 128 MiB, evicts the least recently used entries, and clears when changing course, disconnecting, selecting local-only mode or reloading the page. Task-held previews remain usable after cache eviction. Saving at pass boundaries waits for Drive to confirm the write before continuing.

Actions within a task are called **Subtasks**. Slice exams has three vertically stacked, foldable subtasks:

1. **Choose files & scan**: choose the combined PDF, destination folder and scan settings, then scan.
2. **Review the split**: inspect the candidate exams, correct front pages and prepare individual PDFs.
3. **Save individual PDFs**: preview, download or save the prepared files to Drive.

During downloading, scanning, preparation or upload, the active banner is muted and a floating progress island at the bottom of the viewport receives focus. It stays visible while scrolling, then returns to an inline status message when processing ends. Drive downloads first request the PDF size from Drive metadata, then show a growing bar and percentage based on received bytes—even when the download response omits Content-Length. If neither metadata nor response headers provide a usable size, an activity bar and received-byte count remain the fallback. Downloads can be cancelled with Cancel scan. Successful completion folds that subtask and opens the next; after saving to Drive, the final subtask folds with its saved-file count in the header. Completed panels can be reopened to inspect their contents. Errors and cancellation keep the relevant panel open for correction or retry. Unavailable subtasks remain folded until their inputs exist. Starting a new batch returns to the first subtask.

## Course setup, tests and scan import

1. Select the **Course directory**, for example `Informatik/08/2026-2027/8a`, in the topbar. Connect Google in the header first. The app checks for `LZKs` and `Klausuren` and asks before creating any missing category folders. Cancel leaves the course unchanged. The subject, school-year and calendar-year hierarchy is maintained manually.
2. Open **Current test** to choose an existing test, or **Create a new test**. Enter the topic and choose **LZK** or **Klausur**. The app creates the next numbered test folder and its `01_Scans`, `02_Korrigiert`, `03_Split` and `04_Previews` subfolders, then selects it. Numbering uses the highest existing numeric folder prefix plus one, independently for each type. Topic whitespace becomes hyphens, preserving umlauts.
3. Open **Import scans** and click **Choose PDF from Drive**. The picker starts in the last scan directory when remembering is enabled; you can browse to another directory. The selected PDF’s actual parent is remembered automatically.
4. Check the subject and class code, and choose the test date (defaults to today in Europe/Berlin). The subject is preselected from the nearest course-path folder named **Physik** or **Informatik**; the dropdown stays editable, and a manual choice is retained for that course. The class code comes from the course folder name. Type and topic come from the current test. If the path contains no recognizable subject or cannot be read, choose the subject manually.
5. Set **Document status** to **Original scan → 01_Scans** (the default) or **Corrected → 02_Korrigiert** for tests corrected on paper. Review the filename and destination, then click **Import scan**. A renamed copy is saved in the selected subfolder, creating it if necessary. Already-corrected imports appear directly in Slice exams. **Import another scan** resets the scan selection while retaining the current test and input directory.

For example, Informatik / LZK / 8a / Zahlen Konvertieren Dezimal Dual on 2026-10-03 produces:

```text
8a/
├── Klausuren/
└── LZKs/
    └── 01_Zahlen-Konvertieren-Dezimal-Dual/
        ├── 01_Scans/
        │   └── 20261003_LZK-IF8a-Zahlen-Konvertieren-Dezimal-Dual.pdf
        ├── 02_Korrigiert/
        ├── 03_Split/
        └── 04_Previews/
```

The original PDF stays unchanged in the scanner input folder. Filename format is `YYYYMMDD_{KA|LZK}-{PH|IF}{class}-{topic}.pdf`. Ambiguous required folder names and existing destination filenames are rejected. If creation or import fails, keep the dialog or tab open and retry; stable folder and copy IDs allow the same job to resume. Inputs stay locked during incomplete jobs. Reloading loses retry tracking; inspect Drive before starting again. Create only one test at a time per course/type across tabs or devices, since Drive does not reserve numbering atomically.

After grading, save the combined corrected PDF to `02_Korrigiert`. **Slice exams** lists these PDFs and defaults to `03_Split` for output.

## Slice exams workflow

With a current test selected, the input directory defaults to `02_Korrigiert` and the output to `03_Split`. Select a PDF from the visible file list. Each directory has a small **Change** button to override it; overrides remain while switching task tabs and reset when the current test changes. Refresh the current test menu to reload the PDF listing. Without a current test, the standalone Drive and local-PDF controls remain available.

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

1. Open **Match students**. With a current test selected, its input directory defaults to `03_Split` and its preview output defaults to `04_Previews`. Use the small **Change** buttons to override either directory. Overrides stay selected across task tabs and reset when the current test changes. Matching renames exams in the input directory; the output directory holds generated previews. Without a course selected, the exam folder is prefilled from the slicing destination when available, or can be chosen independently.
2. Choose a **student CSV** from Drive. The example in `resources/example_student_list.csv` uses a UTF-8 BOM and semicolons. Required headers are `Nr.`, `Nachname`, `Vorname`, and `E-Mail-Adresse`; other columns are available as placeholders when preparing drafts. Comma delimiters, quoted fields and Windows-1252 exports are also supported.
3. Connect Google in the header before opening this task. Its shared authorization includes broader Drive access so exams from earlier sessions or other tools can be listed and renamed. See [Google's scope reference](https://developers.google.com/workspace/drive/api/guides/api-specific-auth).
4. Click **Find exams & students**. The setup subtask folds and **Select exam files** opens with all PDFs directly in that folder checked by default. Uncheck files to exclude them, or use **Select all** / **Select none**. Listing includes all result pages and does not download the exam PDFs. Click **Download & start matching** to preload only the selected PDFs and render their name previews; the selection panel then folds and **Match students & rename** opens. Progress and cancellation are available during preloading. Moving between exams uses this in-memory cache, without downloading again. Subfolders and non-PDFs are excluded.
5. Inspect the right half of the front page's top quarter. **View full front page** shows the rest if handwriting falls outside this area. Type a first or last name in **Student** and choose a suggestion. Suggestions include the student number and email address. Tab completes the name when only one matching student remains; ambiguous queries are not completed. Once a student is selected, Enter performs **Rename & next**; no OCR or automatic handwriting assignment is used.
6. Check the proposed filename and click **Rename & next**. This immediately renames the existing Drive file to `Nr_Nachname_Vorname.pdf`, preserving spelling and umlauts (for example `01_Müller_Anna.pdf`). Characters unsuitable for filenames are replaced with hyphens. PDF contents, file IDs and folder location stay unchanged.
7. Continue with the next unmatched selected exam. After the final match, the matching panel folds automatically and a completion message appears below it. Reopen its banner to review any exam. All four subtask banners remain visible, with unavailable panels folded and disabled. **Previous** and **Next / skip for now** let you revisit pages. Already-named files are recognized by exact filename; this is not proof that the handwritten name is correct, so they remain reviewable.
8. Once every selected exam has a student filename, **Create exam previews** opens. Click **Create previews** to save one preview per selected exam. Previews keep the exact exam filenames, for example `04_Previews/01_Müller_Anna.pdf`. Select `04_Previews` as the exam folder in **Prepare emails** to match and send these previews using the existing student CSV. Each preview is a single-page PDF showing only the full-width upper 20% of the front page, respecting its displayed rotation and crop box. The header is rendered into the new PDF, so the remaining page content and subsequent pages are excluded.
9. Previews are saved in the selected output directory. By default this is `04_Previews` inside the current Test folder, created if missing; without a current test it is created beside the selected exam folder. Existing preview filenames are kept; duplicate folder or preview names must be resolved before continuing. Progress and links to saved files appear in the subtask. If an upload fails, keep this tab open and choose **Retry remaining previews**. Directory changes are disabled during an incomplete export, and stable file IDs prevent duplicate uploads after a lost response. Reopening matching with the same files recognizes existing previews instead of uploading them again.

The `Nr.` column must contain unique numeric student numbers; filename numbers are padded to at least two digits (1 becomes 01). Existing leading zeros and numbers longer than two digits are preserved. Students with identical names are distinguished by their numbers. Before each rename the folder is checked again for a conflicting PDF name; existing PDFs are never overwritten. Drive does not offer an atomic unique-filename constraint, so concurrent changes from another app can still introduce duplicates. A retry after a lost rename response recognizes the completed rename. Errors leave the current exam available for retry or another choice.

The CSV, all exam PDFs and all name previews are kept in browser memory until the matching inputs change, reload, or disconnect. Large folders therefore require enough browser memory. Cancelled or failed preloads release the partial cache and leave file selection open for retry. Changing the checked files clears the prepared previews and requires preloading again; completed Drive renames are preserved. Renamed filenames persist in Drive; no matching spreadsheet or student metadata is uploaded. Reloading requires selecting the folder and CSV again. Email addresses are read for matching context and future draft work; no email is sent or drafted by the matching task.

## Batch send workflow

1. Connect Google in the header, then open **Batch send**. The shared authorization includes Gmail access (`gmail.compose`). Gmail API must be enabled in your Google Cloud project.
2. Click **Load drafts**. The app searches all result pages using exactly `label:bulk-send`; subject tags are not used. Apply `bulk-send` using Prepare emails or Gmail. Newly applied labels may take time to appear in Gmail and search.
3. Check the drafts to send (initially none are selected), or use **Select all**. Review the account, subject, To/Cc/Bcc, message snippet and attachment names. Open Gmail to inspect full message contents if needed.
4. **Batch send** immediately sends only the selected existing drafts, including their original attachments. Successful sends are marked and cannot be selected again. The panel folds when the selection completes.

The account, label search membership and draft contents are checked again before sending. Avoid editing drafts in Gmail while sending: Gmail has no atomic conditional send operation. Sending stops on the first failure. **Stop after this email** lets the current operation finish. An uncertain response disables retry for that draft; check Gmail Sent manually. Outcome tracking lasts for this page session, including list refreshes, but is lost on page reload. Prepare emails remains independent and never sends automatically.

Custom draft labels were verified successfully against the user’s Gmail account using both `messages.modify` and `threads.modify`, despite the restriction stated in Google’s documentation. Prepare emails uses `messages.modify` and verifies the applied labels by reading the draft back.

## Prepare emails workflow

1. Open **Prepare emails**. The folder and CSV are prefilled from Match students when available, or can be selected independently. Filenames must match the padded `NR_NACHNAME_VORNAME.pdf` names derived from the CSV.
2. Connect Google in the header to authorize Drive, Gmail drafts and Gmail labels together. Gmail API must be enabled in your Google Cloud project. Google's scope includes sending permission, and is also used by the separate Batch send task. Prepare emails never sends emails.
3. Click **Load recipients & exams**. The app reads the Gmail account, CSV and folder listing. It selects PDFs with an exact filename match and a valid student email. Unmatched names, duplicate PDF names and missing/invalid addresses are shown as issues and cannot be selected. Other valid PDFs may be unchecked.
4. Write subject and plain-text body templates. Placeholders use CSV column headers, such as `{{Vorname}}`, `{{Nachname}}`, `{{Nr.}}`, `{{E-Mail-Adresse}}`, or additional columns like `{{Klasse}}`. Unknown or incomplete placeholders are rejected. There is no code execution, HTML formatting, conditionals or loops.
5. **Gmail labels** defaults to `bulk-send`. Edit the comma-separated list or clear it to create unlabeled drafts. Subject tags have been removed; the subject is exactly the expanded subject template.
6. Click **Preview drafts** and review every recipient, personalized subject/body and attachment filename. Then click **Create drafts in Gmail**. Each selected PDF is downloaded and attached as `application/pdf` using MIME attachment encoding; no Drive sharing link is substituted. Use **Shared attachments for all students** to select multiple shared files from your computer or Google Drive (for example, a marking guide), using the controls below the message template. The exam and all shared files are real MIME attachments; their combined size must not exceed 25 MB per draft. Drive files are downloaded once at selection and retained for all drafts and retries. Google Docs, Sheets, Slides and Drawings are exported to PDF (Google limits exports to 10 MB). Unsupported Google-native items such as folders, shortcuts and Forms are rejected. All shared attachments are listed in every preview. Add more files from either source, or remove files individually before creation. A failed or cancelled Drive selection keeps existing attachments and adds none of the files from that selection.
   Enter comma-separated **Gmail labels**, for example `bulk-send, 8A, Informatik`. The header connection includes `gmail.modify` (add `https://www.googleapis.com/auth/gmail.modify` to the OAuth consent configuration). Existing labels are reused and missing ones created. Labels are shown in the preview, applied after draft creation, and verified before the draft is marked complete.
7. Completed drafts appear in Gmail's Drafts folder for manual checks and sending. The final panel folds automatically when the batch completes. The app displays the account used; if Gmail opens another account, switch to the displayed account.

Once creation starts, folder, recipients and templates are locked for consistent retries. Completed drafts are skipped when resuming. If a draft was saved but labeling failed, retry applies only missing labels to that existing draft, without downloading the exam or creating another draft. **Stop after this draft** finishes the in-flight operation without starting another. An ambiguous creation response is reconciled by searching for the draft's unique Message-ID; if Gmail cannot confirm it, the app stops instead of risking a duplicate. Keep this tab open: retry tracking is in memory, and reloading then creating another batch can create duplicate drafts. Search indexing can delay confirmation after a lost response. If it cannot be confirmed, check Gmail manually before starting a new batch; abandoning an incomplete batch asks for confirmation because its retry tracking will be discarded. PDFs in Drive are neither renamed nor modified by this task.

## Data and limitations

If Picker opens but clicking **Select** does nothing, check `VITE_GOOGLE_APP_ID` first: it must be the numeric **project number**, not the textual project ID or project name. The project number, OAuth client and API key must belong to the same Google Cloud project. Restart the development server after changing `.env`, reload the page, and reconnect Google Drive. The app validates the project number format before opening Picker.

If it still fails, open the browser’s developer console before clicking **Select**. The app logs `[Drive Picker]` lifecycle events without tokens, file IDs or filenames. An `Opening` event followed by `loaded`, but no `picked` callback after selection, indicates that Google’s iframe has not delivered the selection to the app. A `Selection accepted` event means the app handled the selected item. Check for accompanying console errors and failed Network requests; share only their hostname/path and status, never query strings, request bodies or authorization headers. Browser privacy settings or extensions can also affect embedded Google content, so compare with another browser to isolate a browser-specific failure. The app cannot read errors inside Google’s cross-origin iframe.

- PDF bytes, generated files and page previews remain in browser memory. Downloads/uploads go directly between the browser and Google Drive. Google-hosted Identity, Picker and font resources require network access.
- Connect Google requests `drive.file`, broader `drive` access to folder contents, `gmail.compose` for drafts and explicit batch sending, and `gmail.modify` for labels together. It performs no exam or email operations on its own. If authorization is incomplete or expires, use Connect Google again; task tabs stay disabled until the shared authorization is ready.
- Like the reference app, the short-lived access token is cached in `sessionStorage` with an expiry buffer. Disconnect clears/revokes the token and clears the current batch. No refresh token is stored.
- Keep the tab open during processing and upload retries. Reloading loses the batch, generated IDs, PDFs and retry state. Reprocessing after a reload can create another set of files.
- QR recognition depends on scan quality. Review the detected boundaries; every QR code counts as a potential front-page marker, including unrelated QR codes within the top 20%. Markers below that region (including upside-down scans) are not detected. Manual corrections are available for unreadable markers.
- Encrypted/password-protected or malformed PDFs are unsupported. Browser memory is the practical size limit for large scans; concurrency and raster resolution are bounded.
- Slicing names files by exam number and page range; matching renames them by student. Prepare emails attaches the renamed files to personalized Gmail drafts.

OCR is not used as a prefilter: it would add text recognition work and could exclude genuine front pages when a keyword is misread. Only QR detection marks a page automatically; keywords alone never do.

## Verification

Contribution guidelines are in [CONTRIBUTING.md](CONTRIBUTING.md). Run the formatter before checking changes:

```bash
npm run format
npm run format:check
npm run lint
npm test
npm run build
npx playwright install chromium
npm run uat
```

`npm run uat` runs the browser acceptance tests against a Vite server with fictional Google configuration. The tests generate their PDFs and student lists in memory and mock Google sign-in, Picker, Drive, and Gmail responses. No live Google account, student archive, or local sample PDF is required. Local-sample tests and the opt-in benchmark are excluded even when sample files are present. Synthetic results validate workflow behavior, not recognition accuracy on real exams.

To use an existing Chromium/Chrome installation instead:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/opt/google/chrome/chrome npm run uat
```

For an opt-in timing run against the local sample, use `SCAN_BENCHMARK=1 npm run test:e2e -- benchmark.spec.ts` (with the browser executable environment variable above if needed). It reports scan times for 1, 2 and 4 workers; PDF import and file transfer are outside the timer.

Unit tests cover grouping, leading-page handling, naming, Drive permissions, token expiry and retry-safe uploads. Browser tests exercise actual PDF rendering/detection/splitting, manual corrections, and a simulated Google Picker/Drive workflow. `npm run test:e2e` also includes optional local-sample tests using `resources/example_lzk.pdf` (or the legacy root filename `20260911_142302_005443.pdf`); PDFs are ignored by Git to avoid committing student scans. Use generated documents for development. Live Google OAuth and upload still need a manual check with your project credentials.

## Source map

- `src/main.ts`: workflow state, progress and event coordination.
- `src/matching.ts`, `src/students.ts`: independent matching workflow and CSV parsing.
- `src/batchSend.ts`: labeled draft selection, review and explicit batch sending.
- `src/drafts.ts`, `src/draftPlan.ts`: draft workflow, file-to-student validation and preview.
- `src/email.ts`, `src/gmail.ts`: MIME attachment encoding and Gmail draft-only API calls.
- `src/googleDrive.ts`: OAuth, Picker, downloads, folder validation and uploads.
- `src/pdf.ts`: bounded concurrent page rendering and lossless page copying.
- `src/qrScanner.ts`, `src/qr.worker.ts`: transferable pixel buffers and background QR detection.
- `src/grouping.ts`: page range validation and output naming.
- `src/view.ts`, `src/styles/main.css`: accessible, responsive workflow UI.
- `tests/`: unit tests and browser integration tests.

API references: [Google Picker](https://developers.google.com/workspace/drive/picker/reference/picker.docsview), [Drive uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [Drive downloads](https://developers.google.com/workspace/drive/api/guides/manage-downloads), [PDF.js examples](https://mozilla.github.io/pdf.js/examples/).

After choosing **Enable Google & remember folder**, student CSV pickers in Match students and Prepare emails remember the parent folder of the last selected CSV using browser local storage. Only the folder ID is saved, across reloads in this browser and app origin. The remembered folder opens as the first view; My Drive and shared drives remain available if you want another folder or the saved folder is no longer accessible. If browser storage is disabled, selection still works without remembering the location. Clearing this site’s browser storage resets the preference.

## GitHub Pages deployment

The repository is configured for `https://<OWNER>.github.io/edu_test_manager/`. No backend is required.

1. Create/push the repository as **edu_test_manager**. In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
2. In **Settings → Secrets and variables → Actions → Variables**, add `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID` with the same public configuration described above. The app ID is the numeric Google Cloud project number. These values are compiled into browser assets; do not supply an OAuth client secret or access token.
3. In the Google Cloud OAuth web client, add `https://<OWNER>.github.io` as an **Authorized JavaScript origin** (no repository path). Retain localhost origins for development. Configure the API key’s website restriction for `https://<OWNER>.github.io/*`, and enable Google Picker, Drive and Gmail APIs as described above. This token-client flow does not require an OAuth redirect endpoint in the application.
4. Review `public/privacy.html` before public deployment. Add the actual operator/controller identity, contact, legal bases, retention and any deployment-specific privacy information or link to your institution’s privacy policy. The supplied page describes technical behavior; it is not a complete operator-specific legal notice. Configure Google’s OAuth consent screen, scopes, test users/publishing status and required verification for your audience.
5. Push to the repository’s default branch (`main` or `master`) or run **Deploy GitHub Pages** manually from that branch. The workflow validates configuration, installs with `npm ci`, runs unit tests, builds and uploads only `dist/`, and deploys through the protected `github-pages` environment. Other branches do not deploy.

Local verification of the production subdirectory:

```sh
npm run build:pages
npm run preview:pages -- --host 127.0.0.1 --port 4173
# Optional browser smoke test (requires Playwright Chromium):
npm run test:pages
```

Open `http://127.0.0.1:4173/edu_test_manager/`. Development (`npm run dev`) remains at `/`. The production assets, PDF workers, Google Picker relay, privacy page and font license links work under the repository path. Only built application files and `public/` content are published; `.env`, student lists, exam resources and test output are not copied to Pages. Do not put private student data in `public/`. A custom domain or renamed repository requires changing the `--base` in the Pages build/preview scripts and Google origin/referrer configuration.

## Privacy choices and local fonts

On first visit, Google scripts and saved student-folder access are blocked until an affirmative choice in the privacy panel. **Enable Google & remember folder** is the default offered option. Alternatives enable Google without remembering or use only local PDF processing. Choosing an option is required; the default is not treated as prior consent. Google OAuth permission is separate. The privacy choice lasts 180 days; it is stored locally to avoid asking on every visit. If browser storage is blocked, choices work for the current page only.

**Privacy & storage settings** is always available below the app. Disabling remembering deletes the folder preference. Selecting local-only mode deletes the app token and folder ID and reloads to unload Google scripts; finish current work first. It does not clear Google’s own cookies or revoke your Google account permissions. The linked privacy notice explains data flows, browser storage, hosting and user controls. It must be completed by the deployment operator before public use; these technical controls are not a blanket legal-compliance certification.

DM Sans and Manrope are bundled with the app using Fontsource packages and served from the same origin, including on GitHub Pages. No Google Fonts requests are made. Their SIL Open Font Licenses are included in `public/fonts/` and linked from the privacy notice.
