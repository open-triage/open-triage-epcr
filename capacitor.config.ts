import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Development identity. Production identity/custody is selected in ticket 013.
  appId: 'org.opentriage.development',
  appName: 'OpenTriage Development',
  webDir: 'apps/web/native-out',
  loggingBehavior: 'none',
  server: { hostname: 'localhost', androidScheme: 'https' },
  android: { allowMixedContent: false, webContentsDebuggingEnabled: false },
};
export default config;
