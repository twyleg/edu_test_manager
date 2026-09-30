import type { GoogleDrive } from './googleDrive';

export interface SavedDraft { id: string; message?: { id: string; threadId?: string } }
export class Gmail {
  constructor(private google: GoogleDrive) {}
  async account(signal?: AbortSignal): Promise<string> {
    const response = await this.google.gmailRequest('profile', { signal });
    const result = await response.json() as { emailAddress?: string };
    if (!result.emailAddress) throw new Error('Gmail did not return the sending account.');
    return result.emailAddress;
  }
  async findDraft(messageId: string): Promise<SavedDraft | undefined> {
    const query = new URLSearchParams({ q: `rfc822msgid:${messageId}`, maxResults: '2' });
    const response = await this.google.gmailRequest(`drafts?${query}`);
    const result = await response.json() as { drafts?: SavedDraft[] };
    if ((result.drafts?.length || 0) > 1) throw new Error('Multiple matching drafts exist. Review them in Gmail.');
    return result.drafts?.[0];
  }
  async create(raw: string): Promise<SavedDraft> {
    const response = await this.google.gmailRequest('drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw } }) });
    const result = await response.json() as SavedDraft;
    if (!result.id) throw new Error('Gmail did not confirm the draft ID.');
    return result;
  }
}
