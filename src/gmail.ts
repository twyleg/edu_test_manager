import type { GoogleDrive } from './googleDrive';

export interface SavedDraft { id: string; message?: { id: string; threadId?: string } }
export interface DraftDetails {
  id: string;
  message: { id: string; snippet?: string; payload?: MessagePart };
}
interface MessagePart { filename?: string; headers?: { name: string; value: string }[]; parts?: MessagePart[] }
export function draftHeader(draft: DraftDetails, name: string): string {
  return draft.message.payload?.headers?.filter(header => header.name.toLowerCase() === name.toLowerCase()).map(header => header.value).join(', ') || '';
}
export function draftAttachments(part?: MessagePart): string[] {
  return part ? [...(part.filename ? [part.filename] : []), ...(part.parts || []).flatMap(draftAttachments)] : [];
}
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
  async listBatchDrafts(signal?: AbortSignal): Promise<DraftDetails[]> {
    const ids = new Set<string>();
    let pageToken = '';
    do {
      const query = new URLSearchParams({ q: 'label:bulk-send', maxResults: '100' });
      if (pageToken) query.set('pageToken', pageToken);
      const response = await this.google.gmailRequest(`drafts?${query}`, { signal });
      const result = await response.json() as { drafts?: SavedDraft[]; nextPageToken?: string };
      for (const draft of result.drafts || []) ids.add(draft.id);
      pageToken = result.nextPageToken || '';
    } while (pageToken);
    const result: DraftDetails[] = [];
    for (const id of ids) result.push(await this.get(id, signal));
    return result;
  }
  async get(id: string, signal?: AbortSignal): Promise<DraftDetails> {
    const response = await this.google.gmailRequest(`drafts/${encodeURIComponent(id)}?format=full`, { signal });
    const result = await response.json() as DraftDetails;
    if (!result.id || !result.message?.id) throw new Error('Gmail returned an incomplete draft. Reload the list.');
    return result;
  }
  async send(id: string): Promise<void> {
    const response = await this.google.gmailRequest('drafts/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    const result = await response.json() as { id?: string };
    if (!result.id) throw new Error('Gmail did not confirm the sent message. Check Gmail Sent before continuing.');
  }
  async create(raw: string): Promise<SavedDraft> {
    const response = await this.google.gmailRequest('drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw } }) });
    const result = await response.json() as SavedDraft;
    if (!result.id) throw new Error('Gmail did not confirm the draft ID.');
    return result;
  }
}
