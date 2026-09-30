export const googleConfig = {
  clientId: (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim(),
  apiKey: (import.meta.env.VITE_GOOGLE_API_KEY as string | undefined)?.trim(),
  appId: (import.meta.env.VITE_GOOGLE_APP_ID as string | undefined)?.trim(),
};

export const driveScope = 'https://www.googleapis.com/auth/drive.file';
export const pdfMimeType = 'application/pdf';
export const folderMimeType = 'application/vnd.google-apps.folder';

export function hasGoogleConfig(): boolean {
  return !getGoogleConfigError();
}

export function getGoogleConfigError(config = googleConfig): string | undefined {
  if (!Object.values(config).every(value => value && !value.startsWith('your-'))) {
    return 'Add the three Google values from .env.example to .env, then restart the app.';
  }
  if (!/^\d+$/.test(config.appId!)) {
    return 'VITE_GOOGLE_APP_ID must be the numeric Google Cloud project number, not the project ID or project name. Copy the project number from Google Cloud project settings into .env, then restart the app.';
  }
}
