interface LegacyFileSystemEntry {
  isFile: boolean;
  isDirectory: boolean;
  fullPath?: string;
  name?: string;
  file(success: (f: File) => void, error: (e: unknown) => void): void;
  createReader(): { readEntries(success: (entries: LegacyFileSystemEntry[]) => void, error: (e: unknown) => void): void };
}

type DirectoryPickerEntry = DirectoryPickerFileHandle | DirectoryPickerDirectoryHandle;

interface DirectoryPickerFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

interface DirectoryPickerDirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirectoryPickerEntry>;
}

async function readEntriesRecursive(directoryEntry: LegacyFileSystemEntry, prefix = ''): Promise<File[]> {
  const files: File[] = [];
  const reader = directoryEntry.createReader();
  const readBatch = () => new Promise<LegacyFileSystemEntry[]>((resolve, reject) => {
    reader.readEntries(resolve, reject);
  });
  let batch: LegacyFileSystemEntry[];
  do {
    batch = await readBatch();
    for (const entry of batch) {
      if (entry.isFile) {
        const file = await new Promise<File>((res, rej) => entry.file(res, rej));
        const path = prefix + file.name;
        files.push(new File([file], path, { type: file.type, lastModified: file.lastModified }));
      } else if (entry.isDirectory) {
        files.push(...await readEntriesRecursive(entry, prefix + (entry.name || '') + '/'));
      }
    }
  } while (batch.length > 0);
  return files;
}

export async function collectFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const allFiles: File[] = [];
  const entries: LegacyFileSystemEntry[] = [];
  for (const item of Array.from(dataTransfer.items)) {
    if (item.kind !== 'file') continue;
    const entryGetter = item as unknown as {
      webkitGetAsEntry?: () => LegacyFileSystemEntry | null;
      getAsEntry?: () => LegacyFileSystemEntry | null;
    };
    const entry = entryGetter.webkitGetAsEntry?.() ?? entryGetter.getAsEntry?.();
    if (entry) {
      entries.push(entry);
    } else {
      const f = item.getAsFile();
      if (f) allFiles.push(f);
    }
  }
  for (const entry of entries) {
    if (entry.isFile) {
      allFiles.push(await new Promise<File>((res, rej) => entry.file(res, rej)));
    } else if (entry.isDirectory) {
      allFiles.push(...await readEntriesRecursive(entry));
    }
  }
  return allFiles;
}

export async function readDirectoryHandle(
  dirHandle: DirectoryPickerDirectoryHandle,
  prefix = '',
  files: File[] = [],
): Promise<File[]> {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file') {
      const f = await entry.getFile();
      files.push(new File([f], prefix + f.name, { type: f.type, lastModified: f.lastModified }));
    } else if (entry.kind === 'directory') {
      await readDirectoryHandle(entry, prefix + entry.name + '/', files);
    }
  }
  return files;
}

export function blobToImage(fileOrBlob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(fileOrBlob);
    const img = new Image();
    img.onload = () => { resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}
