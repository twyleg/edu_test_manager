import type { GoogleDrive } from './googleDrive';
import type { DriveItem } from './types';
import type { Subject } from './testNames';

export function subjectFromFolderName(name: string): Subject | undefined {
  const subjects = (['Physik', 'Informatik'] as const).filter((subject) =>
    new RegExp(`(?:^|[^\\p{L}])${subject}(?:$|[^\\p{L}])`, 'iu').test(name),
  );
  return subjects.length === 1 ? subjects[0] : undefined;
}

/** Use the nearest subject folder; missing or inaccessible ancestors leave manual selection available. */
export async function deriveCourseSubject(
  drive: GoogleDrive,
  course: DriveItem,
): Promise<Subject | undefined> {
  const visited = new Set<string>();
  let folder = course;
  while (!visited.has(folder.id) && visited.size < 30) {
    visited.add(folder.id);
    const subject = subjectFromFolderName(folder.name);
    if (subject) {
      return subject;
    }
    try {
      folder = await drive.getParentFolder(folder);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
