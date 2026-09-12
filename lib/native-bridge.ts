import { Capacitor, registerPlugin } from '@capacitor/core';

export interface NativeConnectionInfo {
  url: string;
  configured: boolean;
}

export interface NativeIdentifyResponse {
  status: number;
  data: Record<string, unknown>;
}

export interface EmberNativePlugin {
  getConnection(): Promise<NativeConnectionInfo>;
  configureConnection(options: {
    url: string;
    token: string;
  }): Promise<NativeConnectionInfo>;
  clearConnection(): Promise<NativeConnectionInfo>;
  identify(options: { body: string }): Promise<NativeIdentifyResponse>;
  saveBackup(options: {
    filename: string;
    contents: string;
  }): Promise<{ saved: boolean }>;
}

/** This bridge is implemented by the Android app, not the hosted website. */
export function isNative(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

/** No browser fallback: tokens are never persisted by JavaScript. */
export const EmberNative = registerPlugin<EmberNativePlugin>('EmberNative');
