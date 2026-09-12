'use client';
import { useEffect } from 'react';

export function PwaSupport() {
  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !('serviceWorker' in navigator) ||
      !window.isSecureContext ||
      /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    )
      return;
    void navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .catch(() => undefined);
  }, []);
  return null;
}
