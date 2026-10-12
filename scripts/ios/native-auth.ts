import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { App } from '@capacitor/app';
import { Share, type ShareOptions } from '@capacitor/share';

const SESSION_KEY = 'session-token';

type NativeAuthBridge = {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
};

type NativeAppBridge = {
  getLaunchUrl(): Promise<string | null>;
  share(options: ShareOptions): Promise<void>;
};

declare global {
  interface Window {
    HuddleNativeAuth?: NativeAuthBridge;
    HuddleNative?: NativeAppBridge;
  }
}

window.HuddleNativeAuth = {
  async getToken() {
    return SecureStorage.getItem(SESSION_KEY);
  },

  async setToken(token) {
    await SecureStorage.setItem(SESSION_KEY, token);
  },

  async clearToken() {
    await SecureStorage.removeItem(SESSION_KEY);
  },
};

window.HuddleNative = {
  async getLaunchUrl() {
    return (await App.getLaunchUrl())?.url ?? null;
  },

  async share(options) {
    await Share.share(options);
  },
};

void App.addListener('appUrlOpen', ({ url }) => {
  window.dispatchEvent(new CustomEvent('huddle:native-url', { detail: { url } }));
});

void App.addListener('resume', () => {
  window.dispatchEvent(new CustomEvent('huddle:native-resume'));
});
