import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import { App } from '@capacitor/app';
import { Share, type ShareOptions } from '@capacitor/share';
import { PushNotifications } from '@capacitor/push-notifications';

const SESSION_KEY = 'session-token';
const PUSH_TOKEN_KEY = 'push-token';

type NativeAuthBridge = {
  getToken(): Promise<string | null>;
  setToken(token: string): Promise<void>;
  clearToken(): Promise<void>;
};

type NativeAppBridge = {
  getLaunchUrl(): Promise<string | null>;
  share(options: ShareOptions): Promise<void>;
  getPushToken(): Promise<string | null>;
  enablePush(): Promise<'granted'|'denied'>;
  refreshPushRegistration(): Promise<void>;
  clearPushToken(): Promise<void>;
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

  async getPushToken() {
    return SecureStorage.getItem(PUSH_TOKEN_KEY);
  },

  async enablePush() {
    let permission=await PushNotifications.checkPermissions();
    if(permission.receive==='prompt' || permission.receive==='prompt-with-rationale') permission=await PushNotifications.requestPermissions();
    if(permission.receive!=='granted')return 'denied';
    await PushNotifications.register();
    return 'granted';
  },

  async refreshPushRegistration() {
    const permission=await PushNotifications.checkPermissions();
    if(permission.receive==='granted')await PushNotifications.register();
  },

  async clearPushToken() {
    await SecureStorage.removeItem(PUSH_TOKEN_KEY);
  },
};

void App.addListener('appUrlOpen', ({ url }) => {
  window.dispatchEvent(new CustomEvent('huddle:native-url', { detail: { url } }));
});

void App.addListener('resume', () => {
  window.dispatchEvent(new CustomEvent('huddle:native-resume'));
});

void PushNotifications.addListener('registration', async ({ value }) => {
  await SecureStorage.setItem(PUSH_TOKEN_KEY,value);
  window.dispatchEvent(new CustomEvent('huddle:push-registration',{detail:{token:value}}));
});

void PushNotifications.addListener('registrationError', error => {
  window.dispatchEvent(new CustomEvent('huddle:push-error',{detail:{message:error.error}}));
});

void PushNotifications.addListener('pushNotificationReceived', notification => {
  window.dispatchEvent(new CustomEvent('huddle:push-received',{detail:notification}));
});

void PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
  window.dispatchEvent(new CustomEvent('huddle:push-action',{detail:notification.data ?? {}}));
});
