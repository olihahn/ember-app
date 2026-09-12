'use client';

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { Expand, Minus, Plus, RotateCcw, X } from 'lucide-react';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  constrainPhotoView,
  FIT_PHOTO_VIEW,
  fitPhotoSize,
  MAX_PHOTO_ZOOM,
  zoomPhotoView,
  type PhotoSize,
  type PhotoView,
} from '@/lib/photo-view';

interface PhotoViewerProps {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  disabled?: boolean;
}

export function PhotoViewer({
  src,
  alt,
  open,
  onOpenChange,
  className = '',
  disabled = false,
}: PhotoViewerProps) {
  const [view, setView] = useState<PhotoView>(FIT_PHOTO_VIEW);
  const [photo, setPhoto] = useState<PhotoSize>({ width: 0, height: 0 });
  const [viewport, setViewport] = useState<PhotoSize>({ width: 0, height: 0 });
  const viewportRef = useRef<HTMLButtonElement>(null);
  const suppressClick = useRef(false);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!open || !element) return;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setViewport(next);
      setView((current) => constrainPhotoView(current, photo, next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, photo]);

  const fitted = fitPhotoSize(photo, viewport);

  function changeOpen(next: boolean) {
    drag.current = null;
    if (next) {
      setView(FIT_PHOTO_VIEW);
    }
    onOpenChange(next);
  }

  function changeZoom(amount: number) {
    setView((current) =>
      zoomPhotoView(current, current.zoom + amount, photo, viewport),
    );
  }

  function move(x: number, y: number) {
    setView((current) =>
      constrainPhotoView({ ...current, x, y }, photo, viewport),
    );
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>) {
    suppressClick.current = false;
    if (view.zoom <= 1 || drag.current || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: view.x,
      y: view.y,
    };
  }

  function pointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = drag.current;
    if (!start || start.pointerId !== event.pointerId) return;
    if (
      Math.abs(event.clientX - start.startX) +
        Math.abs(event.clientY - start.startY) >
      4
    )
      suppressClick.current = true;
    move(
      start.x + event.clientX - start.startX,
      start.y + event.clientY - start.startY,
    );
  }

  function pointerEnd(event: PointerEvent<HTMLButtonElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const steps: Record<string, [number, number]> = {
      ArrowLeft: [-40, 0],
      ArrowRight: [40, 0],
      ArrowUp: [0, -40],
      ArrowDown: [0, 40],
    };
    const step = steps[event.key];
    if (step) move(view.x + step[0], view.y + step[1]);
    else if (event.key === '+' || event.key === '=') changeZoom(0.5);
    else if (event.key === '-') changeZoom(-0.5);
    else if (event.key === '0') setView(FIT_PHOTO_VIEW);
    else return;
    event.preventDefault();
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger
        type="button"
        className={`text-button photo-view-trigger ${className}`}
        disabled={disabled}
      >
        <Expand size={16} />
        View full photo
      </DialogTrigger>
      <DialogContent
        className="ember-dialog photo-viewer-dialog"
        showCloseButton={false}
      >
        <div className="dialog-titlebar photo-viewer-heading">
          <div>
            <DialogTitle>Every little detail.</DialogTitle>
            <DialogDescription>
              Tap the photo or use + to zoom. Drag or use the arrow keys to
              bring the band into view.
            </DialogDescription>
          </div>
          <DialogClose
            type="button"
            className="icon-button"
            aria-label="Close full photo"
          >
            <X size={20} />
          </DialogClose>
        </div>
        <button
          type="button"
          ref={viewportRef}
          className="photo-viewer-viewport"
          aria-label={`${alt}. Tap to ${view.zoom >= MAX_PHOTO_ZOOM ? 'fit' : 'zoom'}. Drag or use arrow keys to move; press zero to fit.`}
          data-zoomed={view.zoom > 1}
          onClick={() => {
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            if (view.zoom >= MAX_PHOTO_ZOOM) setView(FIT_PHOTO_VIEW);
            else changeZoom(0.5);
          }}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
          onKeyDown={keyDown}
        >
          <span className="photo-viewer-canvas">
            <img
              src={src}
              alt={alt}
              draggable={false}
              onLoad={(event) =>
                setPhoto({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                })
              }
              style={{
                width: fitted.width,
                height: fitted.height,
                transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`,
              }}
            />
          </span>
        </button>
        <fieldset
          className="photo-viewer-toolbar"
          aria-label="Photo view controls"
        >
          <button
            type="button"
            className="ember-button secondary photo-zoom-button"
            aria-label="Zoom out"
            onClick={() => changeZoom(-0.5)}
            disabled={view.zoom <= 1}
          >
            <Minus size={18} />
          </button>
          <output
            className="photo-zoom-level"
            aria-live="polite"
            aria-label="Photo magnification relative to fit"
          >
            {view.zoom.toFixed(1)}×
          </output>
          <button
            type="button"
            className="ember-button secondary photo-zoom-button"
            aria-label="Zoom in"
            onClick={() => changeZoom(0.5)}
            disabled={view.zoom >= MAX_PHOTO_ZOOM}
          >
            <Plus size={18} />
          </button>
          <button
            type="button"
            className="ember-button secondary photo-fit-button"
            onClick={() => setView(FIT_PHOTO_VIEW)}
          >
            <RotateCcw size={16} />
            Fit photo
          </button>
        </fieldset>
        <p className="photo-viewer-note">
          This only changes your view. The saved photo and scan stay the same.
        </p>
      </DialogContent>
    </Dialog>
  );
}
