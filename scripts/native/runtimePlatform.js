// Capacitor's injected bridge is the sole platform authority. An Android
// browser (including an installed PWA) must continue to behave as Web.
export function isNativePlatform(scope = globalThis) {
  return scope.Capacitor?.isNativePlatform?.() === true;
}

export function isNativeAndroid(scope = globalThis) {
  return isNativePlatform(scope) && scope.Capacitor?.getPlatform?.() === 'android';
}
