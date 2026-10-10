import { getGoogleConfigError, hasGoogleConfig } from './config';
import type { DriveItem, ExamFile, PageScan } from './types';

export interface AppState {
  task: 'preparation' | 'slice' | 'match' | 'documentation' | 'drafts' | 'send';
  expanded: Record<'setup' | 'review' | 'save', boolean>;
  ready: boolean;
  connected: boolean;
  localOnly?: boolean;
  hasConnected?: boolean;
  busy:
    | ''
    | 'connect'
    | 'picker'
    | 'scan'
    | 'split'
    | 'upload'
    | 'folder'
    | 'match'
    | 'documentation'
    | 'drafts'
    | 'send'
    | 'preparation';
  source?: DriveItem;
  correctedPdfs?: DriveItem[];
  inputFolder?: DriveItem;
  workflowTest?: boolean;
  localFile?: File;
  folder?: DriveItem;
  pages: PageScan[];
  frontPages: boolean[];
  files: ExamFile[];
  uploadStarted: boolean;
  message: string;
  error: string;
  progress: number | null;
  scanThreads: number;
}

export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (value) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[value]!,
  );

const icon = (kind: 'file' | 'folder' | 'cut' | 'zoom') => {
  const paths = {
    zoom: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    folder:
      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
    cut: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="m8.2 8.2 12.8 12.8M14 10l7-7M8.2 15.8 3-3"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
};

function renderSliceFileList(state: AppState): string {
  const files = state.correctedPdfs || [];
  const disabled = Boolean(state.busy || state.uploadStarted || state.pages.length);
  return `<div id="slice-file-list" class="slice-file-list" role="group" aria-label="Exam PDF" tabindex="-1">
      <div class="test-menu-heading"><strong>Available PDFs</strong></div>
      <div class="test-menu-list">
        ${
          files.length
            ? files
                .map((file, index) => {
                  const selected = state.source?.id === file.id;
                  return `<button id="slice-file-choice-${index}" class="test-menu-choice" data-slice-file-id="${escapeHtml(file.id)}" aria-pressed="${selected}" ${disabled ? 'disabled' : ''}><strong>${escapeHtml(file.name)}</strong>${selected ? '<span class="test-menu-check" aria-hidden="true">✓</span>' : ''}</button>`;
                })
                .join('')
            : '<p class="test-menu-empty">No PDFs available in this folder.</p>'
        }
      </div>
  </div>`;
}

export function renderApp(
  state: AppState,
  matchingPanel = '',
  draftsPanel = '',
  sendPanel = '',
  preparationPanel = '',
  workflowPanel = '',
  workflowInputs = '',
  documentationPanel = '',
): string {
  const { busy, pages, files } = state;
  const processing = busy === 'scan' || busy === 'split' || busy === 'upload';
  const locked = Boolean(busy || state.uploadStarted);
  const selected = state.localFile?.name || state.source?.name;
  const examCount = state.frontPages.filter(Boolean).length;
  const groups: { start: number; end: number; candidate: number }[] = [];
  let candidate = 0;
  pages.forEach((_, index) => {
    if (index === 0 || state.frontPages[index]) {
      if (state.frontPages[index]) {
        candidate++;
      }
      groups.push({ start: index, end: index, candidate });
    } else {
      groups[groups.length - 1].end = index;
    }
  });
  const uploaded = files.filter((file) => file.uploaded).length;
  const allUploaded = files.length > 0 && uploaded === files.length;
  const disabled = (condition: boolean) => (condition ? 'disabled' : '');
  const googleDisabled = !state.ready || !hasGoogleConfig();
  const subtask = (
    key: 'setup' | 'review' | 'save',
    number: number,
    title: string,
    summary: string,
    available: boolean,
    active: boolean,
  ) => `<section class="subtask workspace-panel ${active ? 'subtask-busy' : ''}" aria-busy="${active}">
    <h2 class="subtask-heading"><button id="toggle-${key}" data-subtask="${key}" aria-expanded="${state.expanded[key]}" aria-controls="subtask-${key}" ${disabled(!available || Boolean(busy))}>
      <span class="step-number">${number}</span><span class="subtask-title">${title}<small>${escapeHtml(summary)}</small></span><span class="fold-chevron" aria-hidden="true">${state.expanded[key] ? '⌃' : '⌄'}</span>
    </button></h2><div id="subtask-${key}" class="subtask-body" ${state.expanded[key] ? '' : 'hidden'}>`;

  return `
    <header class="topbar"><div class="shell topbar-inner">
      <a class="brand" href="./"><span class="brand-mark">${icon('cut')}</span> EDU <span class="brand-light">Test Manager</span></a>
      <div class="connection"><span class="connection-label"><i class="status-dot ${state.connected ? 'online' : ''}"></i>${state.connected ? 'Google connected' : 'Google not connected'}</span>
        <button id="connect" class="btn btn-sm ${state.connected ? 'btn-outline-secondary' : 'btn-primary'}" ${disabled(Boolean(busy) || googleDisabled)}>${busy === 'connect' ? 'Connecting…' : state.connected ? 'Disconnect' : 'Connect Google'}</button>
      </div>
      ${workflowInputs}
    </div></header>
    <main class="shell">
      ${workflowPanel}
      <nav class="task-tabs" role="tablist" aria-label="Tasks">
        ${(['preparation', 'slice', 'match', 'documentation', 'drafts', 'send'] as const).map((task, index) => `<button id="task-${task}" role="tab" aria-selected="${state.task === task}" aria-controls="panel-${task}" tabindex="${state.task === task ? 0 : -1}" data-task="${task}" ${disabled(Boolean(busy) || !state.connected)}>${['Import scans', 'Slice exams', 'Match students', 'Create documentation', 'Prepare emails', 'Batch send'][index]}</button>`).join('')}
      </nav>
      <div id="error" role="alert" ${state.error ? '' : 'hidden'} class="alert alert-danger">${escapeHtml(state.error)}</div>
      ${!state.connected && !state.localOnly ? '<section class="workspace-panel connection-start"><h1>Connect to start</h1><p>Use Connect Google in the header to enable tasks and choose your course, student list, and test.</p></section>' : ''}
      <div ${!state.connected && !state.localOnly && !state.hasConnected ? 'hidden' : ''}>
      ${state.task === 'match' ? matchingPanel : ''}
      ${state.task === 'documentation' ? documentationPanel : ''}
      ${state.task === 'drafts' ? draftsPanel : ''}
      ${state.task === 'send' ? sendPanel : ''}
      ${state.task === 'preparation' ? preparationPanel : ''}
      <div id="panel-slice" role="tabpanel" aria-labelledby="task-slice" ${state.task === 'slice' ? '' : 'hidden'}>
      ${!hasGoogleConfig() ? `<aside class="setup-note" role="alert"><strong>Check your Google Drive configuration.</strong> ${escapeHtml(getGoogleConfigError()!)} See the README for setup. You can try slicing a local PDF below.</aside>` : ''}
      ${pages.length ? `<div class="batch-actions"><button id="reset" class="btn btn-sm btn-outline-secondary" ${disabled(Boolean(busy))}>Start a new batch</button></div>` : ''}
      ${subtask('setup', 1, 'Choose files & scan', pages.length ? `${pages.length} pages scanned · ${selected}` : selected || 'Choose an exam PDF and its output folder', true, busy === 'scan')}
      <div aria-label="PDF selection">
        ${
          state.workflowTest
            ? `<div class="slice-folders">
          <div class="slice-source">
            <div class="slice-folder-heading"><div><span class="form-label">Input directory</span><strong>${escapeHtml(state.inputFolder?.name || '02_Korrigiert not found')}</strong></div><button id="choose-slice-input" class="btn btn-sm btn-outline-secondary" aria-label="Change input folder" ${disabled(locked || googleDisabled)}>Change</button></div>
            ${renderSliceFileList(state)}
          </div>
          <div class="slice-destination"><div class="slice-folder-heading"><div><span class="form-label">Output directory</span><strong>${escapeHtml(state.folder?.name || '03_Split not found')}</strong></div><button id="choose-folder" class="btn btn-sm btn-outline-secondary" aria-label="Change output folder" ${disabled(locked || googleDisabled)}>Change</button></div></div>
        </div>`
            : `        <div class="selection-grid">
          <div class="selection-step"><div class="step-heading"><h3>Choose the exam scan</h3></div>
            <p>The single PDF containing all students’ tests.</p>
            <div class="file-selection ${selected ? 'has-selection' : ''}"><span class="selection-icon">${icon('file')}</span><div><strong>${selected ? escapeHtml(selected) : 'No PDF selected'}</strong><span>${selected ? (state.localFile ? 'Local PDF · processed in your browser' : 'PDF from Google Drive') : 'Select a PDF from Google Drive'}</span></div></div>
            ${state.correctedPdfs ? renderSliceFileList(state) : ''}
            <div class="selection-actions"><button id="choose-pdf" class="btn btn-outline-primary" ${disabled(locked || googleDisabled)}>Choose PDF from Drive</button>
              <label class="local-label ${locked ? 'disabled' : ''}">or use a local PDF<input id="local-pdf" type="file" accept="application/pdf,.pdf" ${disabled(locked)} /></label></div>
          </div>
          <div class="selection-step"><div class="step-heading"><h3>Choose the output folder</h3></div>
            <p>Individual PDFs will be saved here in Google Drive.</p>
            <div class="file-selection ${state.folder ? 'has-selection' : ''}"><span class="selection-icon">${icon('folder')}</span><div><strong>${state.folder ? escapeHtml(state.folder.name) : 'No folder selected'}</strong><span>${state.folder ? 'Google Drive destination' : 'Choose where the sliced exams will go'}</span></div></div>
            <div class="selection-actions"><button id="choose-folder" class="btn btn-outline-primary" ${disabled(locked || googleDisabled)}>Choose Drive folder</button><button id="new-folder" class="btn btn-outline-primary" ${disabled(locked || googleDisabled || !state.connected)}>New folder</button></div>
            <p class="folder-hint">Click the Name column in the picker to sort alphabetically. Single-click the folder’s row, then click Select. New folders are created inside the selected folder, or in My Drive if none is selected.</p>
          </div>
        </div>
`
        }
        <div class="px-4 py-3 border-top d-flex flex-wrap gap-3 align-items-center">
          <label for="scan-threads" class="fw-semibold">Scan threads</label>
          <input id="scan-threads" class="form-control" style="width:5rem" type="number" min="1" max="8" step="1" value="${state.scanThreads}" ${disabled(locked)} aria-describedby="scan-hint" />
          <span id="scan-hint" class="text-secondary small">Search the top 20% of each page. More threads use more memory (1–8).</span>
        </div>
        <div class="panel-footer"><div><span></span></div>
          <button id="scan" class="btn btn-primary" ${disabled(locked || !selected || pages.length > 0)}>${icon('cut')} ${busy === 'scan' ? 'Scanning…' : 'Scan PDF'}</button></div>
      </div></div></section>
      <div id="task-progress" tabindex="-1" class="progress-area ${processing ? 'progress-active progress-island' : ''}" ${state.message ? '' : 'hidden'}>
        <div class="progress-caption"><span role="status" aria-live="polite">${escapeHtml(state.message)}</span>${busy === 'scan' ? '<button id="cancel" class="btn btn-sm btn-outline-secondary">Cancel scan</button>' : ''}</div>
        ${processing ? `<div class="progress ${state.progress === null ? 'progress-indeterminate' : ''}" role="progressbar" aria-label="Processing progress" ${state.progress === null ? '' : `aria-valuenow="${Math.round(state.progress)}"`} aria-valuemin="0" aria-valuemax="100" aria-valuetext="${escapeHtml(state.message)}"><div class="progress-bar" style="width:${state.progress === null ? 35 : state.progress}%"></div></div>` : ''}
      </div>
      ${subtask('review', 2, 'Review the split', pages.length ? `${pages.length} pages · ${examCount} candidate exams` : 'Available after scanning', pages.length > 0, busy === 'split')}
      ${
        pages.length
          ? `<section class="review-section" aria-labelledby="review-heading">
        <div class="section-heading"><div><p class="eyebrow">REVIEW THE SPLIT</p><h2 id="review-heading">${pages.length} page${pages.length === 1 ? '' : 's'}. ${examCount} exam${examCount === 1 ? '' : 's'}.</h2></div>
          </div>
        <p class="section-description">A checked page starts a new exam. All following pages belong to it until the next checked page. Each row is one candidate exam. Changing a checkbox updates the rows immediately. Use the magnifier to inspect a full page. Skip unwanted pages, rotate them, or drag pages within an exam to reorder them (arrow buttons work too). Front pages stay first and cannot be skipped. Page numbers refer to the original scan.</p>
        <div class="exam-groups">${groups
          .map(
            (
              group,
            ) => `<section class="exam-group ${group.candidate ? '' : 'unassigned-group'}" aria-label="${group.candidate ? `Exam ${group.candidate}` : 'Unassigned pages'}">
          <header class="exam-group-heading"><h3>${group.candidate ? `Exam ${String(group.candidate).padStart(2, '0')}` : 'Unassigned pages'}</h3><span>Pages ${group.start + 1}–${group.end + 1} · ${group.end - group.start + 1} page${group.end === group.start ? '' : 's'}</span></header>
          ${!group.candidate ? '<p class="unassigned-note">Select a front page to include these leading pages in an exam.</p>' : ''}
          <div class="page-grid" tabindex="0" aria-label="${group.candidate ? `Pages of exam ${group.candidate}` : 'Unassigned page previews'}">${pages
            .slice(group.start, group.end + 1)
            .map((page, offset) => {
              const index = group.start + offset;
              return `<article data-page-index="${index}" draggable="${!locked && group.candidate > 0 && !state.frontPages[index]}" class="page-card ${state.frontPages[index] ? 'front-page' : ''} ${page.skipped ? 'page-skipped' : ''}">
              <div class="page-image"><img src="${page.thumbnailUrl}" alt="Scanned page ${page.pageNumber}" draggable="false" style="transform:rotate(${page.rotation || 0}deg) scale(${(page.rotation || 0) % 180 ? 0.72 : 1})" loading="lazy"/><span class="page-index">${page.pageNumber}</span></div>
              <span class="page-detection">${page.hasQr ? 'QR marker detected' : 'No QR marker detected'}</span>
              <div class="page-controls"><label class="page-check"><input id="front-${index}" type="checkbox" data-page="${index}" ${state.frontPages[index] ? 'checked' : ''} ${disabled(locked)}/> Front page</label>
                <button id="preview-${index}" data-preview="${index}" class="btn btn-sm btn-outline-secondary page-zoom" aria-label="View page ${page.pageNumber}" title="View full page" ${disabled(Boolean(busy))}>${icon('zoom')}</button></div>
              <div class="page-edit-controls">
                <label class="page-check"><input id="skip-${index}" type="checkbox" data-skip="${index}" ${page.skipped ? 'checked' : ''} ${disabled(locked || state.frontPages[index])} /> Skip page</label>
                <div class="page-edit-buttons">
                  <button id="rotate-left-${index}" data-rotate="${index}" data-angle="-90" class="btn btn-sm btn-outline-secondary" aria-label="Rotate page ${page.pageNumber} left" title="Rotate left" ${disabled(locked)}>↶</button>
                  <button id="rotate-right-${index}" data-rotate="${index}" data-angle="90" class="btn btn-sm btn-outline-secondary" aria-label="Rotate page ${page.pageNumber} right" title="Rotate right" ${disabled(locked)}>↷</button>
                  <button id="move-left-${index}" data-move="${index}" data-direction="-1" class="btn btn-sm btn-outline-secondary" aria-label="Move page ${page.pageNumber} earlier" title="Move earlier" ${disabled(locked || !group.candidate || index <= group.start + 1)}>←</button>
                  <button id="move-right-${index}" data-move="${index}" data-direction="1" class="btn btn-sm btn-outline-secondary" aria-label="Move page ${page.pageNumber} later" title="Move later" ${disabled(locked || !group.candidate || state.frontPages[index] || index === group.end)}>→</button>
                </div>
              </div>
            </article>`;
            })
            .join('')}</div>
        </section>`,
          )
          .join('')}</div>
        <div class="review-actions"><span>Original pages and print quality are preserved.</span><button id="prepare" class="btn btn-primary" ${disabled(locked || files.length > 0)}>Prepare ${examCount} PDF${examCount === 1 ? '' : 's'}</button></div>
      </section>`
          : ''
      }
      </div></section>
      ${subtask('save', 3, 'Save individual PDFs', files.length ? `${files.length} PDFs prepared · ${uploaded} saved to Drive` : 'Available after reviewing and preparing PDFs', files.length > 0, busy === 'upload')}
      ${
        files.length
          ? `<section class="results-section" aria-labelledby="results-heading"><div class="section-heading"><div><p class="eyebrow">INDIVIDUAL EXAMS</p><h2 id="results-heading">${allUploaded ? 'All exams saved to Drive' : 'Your PDFs are ready'}</h2></div><span class="count-badge">${uploaded} / ${files.length} saved</span></div>
        <div class="result-list">${files.map((file, index) => `<article class="result-row"><span class="result-number">${String(index + 1).padStart(2, '0')}</span><div class="result-info"><strong>${escapeHtml(file.name)}</strong><span>Source pages ${file.pageNumbers.join(', ')} · ${file.pageNumbers.length} page${file.pageNumbers.length === 1 ? '' : 's'} · ${formatSize(file.blob.size)}</span>${file.error ? `<span class="text-danger">${escapeHtml(file.error)}</span>` : ''}</div><div class="result-actions"><a href="${file.previewUrl}" target="_blank" rel="noopener" class="btn btn-sm btn-outline-secondary">Preview</a><a href="${file.previewUrl}" download="${escapeHtml(file.name)}" class="download-link">Download</a>${file.uploaded ? `<a class="saved-link" target="_blank" rel="noopener" href="https://drive.google.com/file/d/${encodeURIComponent(file.driveId!)}/view">Saved ↗</a>` : '<span class="pending-label">Pending</span>'}</div></article>`).join('')}</div>
        <div class="upload-footer"><p>${state.folder ? `Destination: <strong>${escapeHtml(state.folder.name)}</strong>` : 'Choose an output folder above to save these PDFs to Drive.'}<span>${state.uploadStarted ? 'Keep this tab open to preserve upload progress and retry safely.' : 'Files use numbered names. Match students is a separate task.'}</span></p>
        <button id="upload" class="btn btn-primary" ${disabled(Boolean(busy) || !state.folder || allUploaded || !state.connected)}>${busy === 'upload' ? 'Saving to Drive…' : allUploaded ? 'All files saved' : state.uploadStarted ? 'Retry remaining uploads' : `Save ${files.length} PDFs to Drive`}</button></div>
      </section>`
          : ''
      }
      </div></section>
      </div>
      </div>
      <footer class="site-footer"><span>EDU Test Manager.</span></footer>
    </main>`;
}

function formatSize(bytes: number): string {
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
