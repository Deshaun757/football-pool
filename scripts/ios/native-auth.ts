import { SecureStorage } from '@aparajita/capacitor-secure-storage';

const SESSION_KEY = 'session-token';

type NativeAuthBridge = {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
};

declare global {
  interface Window {
    HuddleNativeAuth?: NativeAuthBridge;
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
