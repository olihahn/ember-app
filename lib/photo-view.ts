export interface PhotoSize {
  width: number;
  height: number;
}

export interface PhotoView {
  zoom: number;
  x: number;
  y: number;
}

export const FIT_PHOTO_VIEW: PhotoView = { zoom: 1, x: 0, y: 0 };
export const MAX_PHOTO_ZOOM = 5;

/** Fit the complete image; the viewer never crops or rewrites its source. */
export function fitPhotoSize(photo: PhotoSize, viewport: PhotoSize): PhotoSize {
  if (!photo.width || !photo.height || !viewport.width || !viewport.height)
    return { width: 0, height: 0 };
  const ratio = Math.min(
    viewport.width / photo.width,
    viewport.height / photo.height,
  );
  return { width: photo.width * ratio, height: photo.height * ratio };
}

export function constrainPhotoView(
  view: PhotoView,
  photo: PhotoSize,
  viewport: PhotoSize,
): PhotoView {
  const zoom = Math.max(1, Math.min(MAX_PHOTO_ZOOM, view.zoom));
  const fitted = fitPhotoSize(photo, viewport);
  const maxX = Math.max(0, (fitted.width * zoom - viewport.width) / 2);
  const maxY = Math.max(0, (fitted.height * zoom - viewport.height) / 2);
  return {
    zoom,
    x: maxX ? Math.max(-maxX, Math.min(maxX, view.x)) : 0,
    y: maxY ? Math.max(-maxY, Math.min(maxY, view.y)) : 0,
  };
}

/** Keep the same image point at the center when changing magnification. */
export function zoomPhotoView(
  view: PhotoView,
  nextZoom: number,
  photo: PhotoSize,
  viewport: PhotoSize,
): PhotoView {
  const zoom = Math.max(1, Math.min(MAX_PHOTO_ZOOM, nextZoom));
  const ratio = zoom / view.zoom;
  return constrainPhotoView(
    { zoom, x: view.x * ratio, y: view.y * ratio },
    photo,
    viewport,
  );
}
