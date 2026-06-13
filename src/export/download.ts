export function stripKnownAnimationExtension(name: string): string {
  return name
    .replace(/\.pam\.json$/i, '')
    .replace(/\.pam\.ya?ml$/i, '')
    .replace(/\.pam\.toml$/i, '')
    .replace(/\.json$/i, '')
    .replace(/\.ya?ml$/i, '')
    .replace(/\.toml$/i, '')
    .replace(/\.pam$/i, '')
    .replace(/\.fla$/i, '');
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
