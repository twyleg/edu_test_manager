import type { GoogleDrive } from './googleDrive';

export interface SavedDraft { id: string; message?: { id: string; threadId?: string } }
export interface DraftDetails {
  id: string;
  message: { id: string; threadId?: string; labelIds?: string[]; snippet?: string; payload?: MessagePart };
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
  async ensureLabels(names: string[]): Promise<string[]> {
    if (!names.length) return [];
    const response = await this.google.gmailLabelRequest('labels');
    const result = await response.json() as { labels?: { id: string; name: string }[] };
    const labels = result.labels || [];
    const ids: string[] = [];
    for (const name of names) {
      let id = labels.find(label => label.name === name)?.id;
      if (!id) {
        const created = await this.google.gmailLabelRequest('labels', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
        id = (await created.json() as { id?: string }).id;
        if (!id) throw new Error('Gmail did not return the created label ID.');
      }
      ids.push(id);
    }
    return ids;
  }
  async labelDraft(id: string, labelIds: string[]): Promise<void> {
    if (!labelIds.length) return;
    const draft = await this.get(id);
    const missing = labelIds.filter(label => !draft.message.labelIds?.includes(label));
    if (missing.length) await this.google.gmailLabelRequest(`messages/${encodeURIComponent(draft.message.id)}/modify`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ addLabelIds: missing }),
    });
    const verified = await this.get(id);
    if (labelIds.some(label => !verified.message.labelIds?.includes(label))) throw new Error('Draft saved, but Gmail has not confirmed all labels. Retry to check or apply the missing labels.');
  }
  async create(raw: string): Promise<SavedDraft> {
    const response = await this.google.gmailRequest('drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: { raw } }) });
    const result = await response.json() as SavedDraft;
    if (!result.id) throw new Error('Gmail did not confirm the draft ID.');
    return result;
  }
}
