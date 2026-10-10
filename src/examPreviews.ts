import { folderMimeType } from './config';
import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';

export function examPreviewFilename(name: string): string {
  if (!/^.+\.pdf$/i.test(name)) throw new Error('Exam previews require a PDF filename.');
  return name;
}

export interface ExamPreviewRow {
  source: DriveItem;
  name: string;
  id?: string;
  saved: boolean;
  existing: boolean;
}

/** Stable upload IDs and filename checks allow retries and later sessions to reuse saved previews. */
export class ExamPreviewExport {
  readonly rows: ExamPreviewRow[];
  folder?: DriveItem;
  private parent?: DriveItem;

  constructor(private sourceFolder: DriveItem, exams: DriveItem[], private outputFolder?: DriveItem, parentFolder?: DriveItem) {
    if (!exams.length) throw new Error('Match at least one exam before creating previews.');
    if (outputFolder?.id === sourceFolder.id) throw new Error('Choose different folders for exams and preview output.');
    if (outputFolder) this.folder = { ...outputFolder };
    if (parentFolder) this.parent = { ...parentFolder };
    this.rows = exams.map(source => ({ source: { ...source }, name: examPreviewFilename(source.name), saved: false, existing: false }));
    const names = this.rows.map(row => row.name.normalize('NFC').toLocaleLowerCase());
    if (new Set(names).size !== names.length) throw new Error('Two exams would have the same preview filename. Resolve duplicate student filenames before creating previews.');
  }

  get savedCount(): number { return this.rows.filter(row => row.saved).length; }
  get complete(): boolean { return this.savedCount === this.rows.length; }

  async run(drive: GoogleDrive, createPdf: (exam: DriveItem) => Promise<Blob>, progress: (message: string, saved: number, total: number) => void): Promise<void> {
    const report = (message: string) => progress(message, this.savedCount, this.rows.length);
    report('Checking matched exams and the preview folder…');
    const sources = await drive.listFolderPdfs(this.sourceFolder.id);
    if (this.rows.some(row => !sources.some(source => source.id === row.source.id && source.name === row.source.name))) {
      throw new Error('An exam was renamed or moved since matching. Reload the exam folder before creating previews.');
    }
    if (!this.outputFolder) {
      this.parent ??= await drive.getParentFolder(this.sourceFolder);
      if (!this.folder) {
        const siblings = await drive.listFolderItems(this.parent.id);
        const matches = siblings.filter(item => item.name === '04_Previews');
        if (matches.length > 1 || matches.some(item => item.mimeType !== folderMimeType)) {
          throw new Error('Resolve duplicate folders or a non-folder named “04_Previews” in the Test folder, then retry.');
        }
        this.folder = matches[0] || { id: await drive.generateFileId(), name: '04_Previews', mimeType: folderMimeType };
      }
      this.folder = await drive.createFolder(this.folder.id, '04_Previews', this.parent.id);
    }
    const destination = this.folder!;
    if (destination.id === this.sourceFolder.id) throw new Error('Choose different folders for exams and preview output.');
    await drive.verifyFolder(destination);
    const existing = await drive.listFolderPdfs(destination.id);
    // Check every name before any upload, so duplicate destination names cannot silently pick the wrong file.
    for (const row of this.rows) {
      const matches = existing.filter(file => file.name.normalize('NFC').toLocaleLowerCase() === row.name.normalize('NFC').toLocaleLowerCase());
      if (matches.length > 1) throw new Error(`Multiple previews are named “${row.name}”. Resolve them in ${destination.name}, then retry.`);
      if (matches.length === 1) {
        row.existing = row.id !== matches[0].id;
        row.id = matches[0].id; row.saved = true;
      } else if (row.saved) {
        throw new Error(`The saved preview “${row.name}” was removed or renamed. Reload the exam folder before creating previews again.`);
      }
    }
    for (const [index, row] of this.rows.entries()) {
      if (row.saved) continue;
      report(`Creating preview ${index + 1} of ${this.rows.length}: ${row.name}`);
      const blob = await createPdf(row.source);
      row.id ??= await drive.generateFileId();
      await drive.uploadPdf(row.id, row.name, destination.id, blob);
      row.saved = true;
      report(`Saved ${this.savedCount} of ${this.rows.length} exam previews.`);
    }
    report(`All ${this.rows.length} exam previews are available in ${destination.name}.`);
  }
}
