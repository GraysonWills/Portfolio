import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.graysonwills.authorstudio',
  appName: 'Author Studio',
  webDir: 'dist/blog-authoring-gui/browser',
  loggingBehavior: 'none',
  ios: {
    contentInset: 'never',
    preferredContentMode: 'mobile',
    backgroundColor: '#eceff3',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 500,
      backgroundColor: '#16273cff',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#eceff3',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'native',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
