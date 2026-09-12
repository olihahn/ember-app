'use client';

import { useEffect } from 'react';
import { focusedFieldScrollDelta } from '@/lib/focus-visibility';

function isEditableField(
  element: Element | null,
): element is HTMLInputElement | HTMLTextAreaElement {
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    )
  )
    return false;
  if (element.disabled || element.readOnly) return false;
  return (
    element instanceof HTMLTextAreaElement ||
    ![
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ].includes(element.type)
  );
}

/** Account for app chrome after Android resizes the already-safe WebView for IME. */
export function useFocusVisibility() {
  useEffect(() => {
    let frame: number | null = null;

    function revealIfCovered() {
      frame = null;
      // Focus can change while the keyboard resizes or a dialog closes.
      const field = document.activeElement;
      if (
        !isEditableField(field) ||
        !field.closest('.ember-app, .ember-dialog')
      )
        return;
      const rect = field.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        window.getComputedStyle(field).visibility === 'hidden'
      )
        return;

      const viewport = window.visualViewport;
      let top = viewport?.offsetTop ?? 0;
      let bottom = top + (viewport?.height ?? window.innerHeight);
      const dialog = field.closest<HTMLElement>('.ember-dialog');
      let scrollArea: HTMLElement | null = null;

      for (
        let parent = field.parentElement;
        parent &&
        parent !== document.body &&
        parent !== document.documentElement;
        parent = parent.parentElement
      ) {
        const style = window.getComputedStyle(parent);
        const clips = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
        if (clips) {
          const bounds = parent.getBoundingClientRect();
          top = Math.max(top, bounds.top + parent.clientTop);
          bottom = Math.min(
            bottom,
            bounds.top + parent.clientTop + parent.clientHeight,
          );
        }
        if (
          !scrollArea &&
          /^(auto|scroll)$/.test(style.overflowY) &&
          parent.scrollHeight > parent.clientHeight + 1
        ) {
          scrollArea = parent;
        }
        if (parent === dialog) break;
      }

      function visibleBounds(element: Element | null) {
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 &&
          bounds.height > 0 &&
          bounds.right > rect.left &&
          bounds.left < rect.right
          ? bounds
          : null;
      }

      if (dialog) {
        const header = visibleBounds(dialog.querySelector('.dialog-titlebar'));
        const footer = visibleBounds(
          dialog.querySelector('.editor-footer, .detail-footer'),
        );
        if (header) top = Math.max(top, header.bottom);
        if (footer) bottom = Math.min(bottom, footer.top);
      } else {
        const nav = visibleBounds(document.querySelector('.mobile-bottom-nav'));
        if (nav && nav.bottom > top && nav.top < bottom)
          bottom = Math.min(bottom, nav.top);
      }

      const delta = focusedFieldScrollDelta(rect, { top, bottom });
      if (Math.abs(delta) < 1) return;
      if (scrollArea) scrollArea.scrollBy({ top: delta, behavior: 'instant' });
      else if (!dialog) window.scrollBy({ top: delta, behavior: 'instant' });
    }

    function schedule() {
      if (frame === null) frame = window.requestAnimationFrame(revealIfCovered);
    }

    document.addEventListener('focusin', schedule);
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      document.removeEventListener('focusin', schedule);
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);
}
