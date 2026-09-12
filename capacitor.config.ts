import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.emberjournal.app',
  appName: 'Ember',
  webDir: 'mobile-dist',
  // Capacitor otherwise logs bridge arguments in debug builds, which can contain
  // pairing tokens, photos, and complete backups.
  loggingBehavior: 'none',
  // The interface is bundled in the APK. No hosted webpage or live-reload URL.
  server: { androidScheme: 'https' },
  // MainActivity owns native safe-area/keyboard insets consistently across
  // WebView versions; do not also inject CSS/native insets through SystemBars.
  plugins: { SystemBars: { insetsHandling: 'disable', style: 'LIGHT' } },
  android: {
    allowMixedContent: false,
    backgroundColor: '#f2dba2',
    loggingBehavior: 'none',
    webContentsDebuggingEnabled: false,
  },
};
export default config;
