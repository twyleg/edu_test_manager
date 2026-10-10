import { folderMimeType } from './config';
import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import { nextTestFolderName, topicSlug, type TestType } from './testNames';

export const courseFolderNames = ['LZKs', 'Klausuren'] as const;
export const testFolderNames = ['01_Scans', '02_Korrigiert', '03_Split', '04_Previews'] as const;
export function uniqueFolder(items: DriveItem[], name: string): DriveItem | undefined {
  const matches = items.filter((item) => item.name === name);
  if (matches.length > 1 || matches.some((item) => item.mimeType !== folderMimeType)) {
    throw new Error(`Resolve duplicate folders or a non-folder named “${name}”, then retry.`);
  }
  return matches[0];
}
export async function missingCourseFolders(
  drive: GoogleDrive,
  course: DriveItem,
): Promise<string[]> {
  const items = await drive.listFolderItems(course.id);
  return courseFolderNames.filter((name) => !uniqueFolder(items, name));
}
/** Retain generated IDs across retries, including a successful write with a lost response. */
export class FolderJob {
  private folders = new Map<string, DriveItem>();

  async ensure(drive: GoogleDrive, parent: DriveItem, name: string): Promise<DriveItem> {
    const key = `${parent.id}/${name}`;
    let folder = this.folders.get(key);
    if (!folder) {
      folder = uniqueFolder(await drive.listFolderItems(parent.id), name);
      if (!folder) {
        folder = { id: await drive.generateFileId(), name, mimeType: folderMimeType };
      }
      this.folders.set(key, folder);
    }
    const result = await drive.createFolder(folder.id, name, parent.id);
    await drive.verifyFolder(result);
    return result;
  }
}
export class TestCreationJob {
  private folders = new FolderJob();
  private name?: string;

  constructor(
    readonly course: DriveItem,
    readonly type: TestType,
    readonly topic: string,
  ) {
    topicSlug(topic);
    if (!['LZK', 'Klausur'].includes(type)) {
      throw new Error('Choose a test type.');
    }
  }

  async run(drive: GoogleDrive): Promise<DriveItem> {
    await drive.verifyFolder(this.course);
    const categoryName = this.type === 'LZK' ? 'LZKs' : 'Klausuren';
    const category = uniqueFolder(await drive.listFolderItems(this.course.id), categoryName);
    if (!category) {
      throw new Error(`Set up ${categoryName} in this course first.`);
    }
    this.name ??= nextTestFolderName(await drive.listFolderItems(category.id), this.topic);
    const test = await this.folders.ensure(drive, category, this.name);
    for (const name of testFolderNames) {
      await this.folders.ensure(drive, test, name);
    }
    return { ...test, name: `${categoryName} / ${test.name}` };
  }
}
