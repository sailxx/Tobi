// A picture on the clipboard through the web Clipboard API, which takes PNG whatever the photo was.
// WebKitGTK builds without image clipboard support say no, and the caller says so.

/** A picture from a data: URL as PNG bytes; null when it can't be drawn. */
function pngBlob(url: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      canvas.getContext("2d")?.drawImage(img, 0, 0);
      canvas.toBlob((b) => resolve(b), "image/png");
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

export async function copyPhoto(url: string): Promise<boolean> {
  const Item = (window as { ClipboardItem?: typeof ClipboardItem }).ClipboardItem;
  if (!Item || !navigator.clipboard?.write) return false;
  try {
    const blob = await pngBlob(url);
    if (!blob) return false;
    await navigator.clipboard.write([new Item({ "image/png": blob })]);
    return true;
  } catch {
    return false;
  }
}
