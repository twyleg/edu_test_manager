const preferenceKey = 'edu-test-manager-privacy-v1';
export const studentFolderStorageKey = 'edu-test-manager-student-list-folder';
const lifetime = 180 * 24 * 60 * 60 * 1000;
interface Preferences { google: boolean; rememberFolder: boolean; expires: number }
let preferences: Preferences | undefined;
try {
  const saved = JSON.parse(localStorage.getItem(preferenceKey) || 'null') as Preferences | null;
  if (saved && typeof saved.google === 'boolean' && typeof saved.rememberFolder === 'boolean' && saved.expires > Date.now() && saved.expires <= Date.now() + lifetime) preferences = saved;
} catch { /* Consent can also be kept in memory when browser storage is unavailable. */ }
export const googleAllowed = () => Boolean(preferences?.google);
export const rememberStudentFolder = () => Boolean(preferences?.google && preferences.rememberFolder);

export function mountPrivacy(onChange: (google: boolean, previouslyAllowed: boolean) => void, isBusy: () => boolean): void {
  const host = document.createElement('aside');
  host.className = 'privacy-shell';
  document.body.append(host);
  let expanded = !preferences;
  const render = () => {
    host.innerHTML = `<div class="shell privacy-footer"><button id="privacy-settings" class="btn btn-sm btn-outline-secondary" aria-expanded="${expanded}">Privacy & storage settings</button> <a href="${import.meta.env.BASE_URL}privacy.html" target="_blank" rel="noopener">Privacy notice</a></div>
      <section class="privacy-panel shell" aria-labelledby="privacy-title" ${expanded ? '' : 'hidden'}>
      <h2 id="privacy-title">Google services & browser storage</h2>
      <p>Local PDF processing works without Google. Enabling Google loads its sign-in and file picker services, which receive connection information such as your IP address and may use cookies. Google authorization is requested separately.</p>
      <p>Remembering the student-list folder is the default option: the student-list folder ID and shared workflow selections (Drive IDs and names) are saved on this browser. You can instead enable Google without remembering folders. No analytics or advertising is added by this app; fonts are hosted locally.</p>
      <p>Your choice is saved for 180 days. A Google access token is kept in session storage after sign-in. Change your choice here at any time. ${googleAllowed() ? 'Switching to local only clears the app token and remembered folder and reloads the page; finish or save your current work first.' : ''}</p>
      <div class="privacy-actions"><button id="privacy-remember" class="btn btn-outline-primary">Enable Google & remember folder</button><button id="privacy-google" class="btn btn-outline-primary">Enable Google without remembering</button><button id="privacy-local" class="btn btn-outline-primary">Use local only${googleAllowed() ? ' (reload)' : ''}</button></div>
      <p id="privacy-feedback" role="status"></p>
      </section>`;
  };
  host.addEventListener('click', event => {
    const id = (event.target as HTMLElement).closest('button')?.id;
    if (id === 'privacy-settings') { expanded = !expanded; render(); return; }
    if (!['privacy-remember', 'privacy-google', 'privacy-local'].includes(id || '')) return;
    if (isBusy()) { host.querySelector('#privacy-feedback')!.textContent = 'Finish the current operation before changing these settings.'; return; }
    const previous = googleAllowed();
    preferences = { google: id !== 'privacy-local', rememberFolder: id === 'privacy-remember', expires: Date.now() + lifetime };
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
      if (!preferences.rememberFolder) { localStorage.removeItem(studentFolderStorageKey); localStorage.removeItem('edu-test-manager-workflow-v1'); }
    } catch { /* A blocked store must not prevent use of the application. */ }
    if (!preferences.google) { try { sessionStorage.removeItem('edu-test-manager-token'); } catch { /* Storage unavailable. */ } }
    expanded = false; render(); onChange(preferences.google, previous);
  });
  render();
}
