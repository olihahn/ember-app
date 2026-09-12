/** Decode locally, correct browser-supported orientation, resize and strip metadata. */
export async function fileToImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/'))
    throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if (file.size > 30 * 1024 * 1024)
    throw new Error('This photo is over 30 MB. Choose a smaller photo.');
  const url = URL.createObjectURL(file);
  try {
    const photo = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () =>
        reject(
          new Error(
            'This photo could not be opened. Try a JPEG or take a new photo.',
          ),
        );
      img.src = url;
    });
    if (!photo.naturalWidth || !photo.naturalHeight)
      throw new Error('This image has no readable pixels.');
    const ratio = Math.min(
      1,
      1600 / Math.max(photo.naturalWidth, photo.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(photo.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(photo.naturalHeight * ratio));
    const context = canvas.getContext('2d');
    if (!context)
      throw new Error('This browser could not prepare your photo. Try Chrome.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(photo, 0, 0, canvas.width, canvas.height);
    let image = canvas.toDataURL('image/jpeg', 0.86);
    if (image.length > 3_900_000) image = canvas.toDataURL('image/jpeg', 0.65);
    if (image.length > 3_900_000)
      throw new Error(
        'This photo is too detailed to save. Try a closer crop of the band.',
      );
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}
