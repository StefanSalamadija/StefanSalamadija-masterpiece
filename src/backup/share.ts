/** Hands the file to the system share sheet where there is one, else downloads it. `cancelled`: the user closed the share sheet. */
export async function shareOrDownload(fileName: string, text: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([text], fileName, { type: 'application/octet-stream' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: fileName });
      return 'shared';
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // after the browser has started reading it
  return 'downloaded';
}
