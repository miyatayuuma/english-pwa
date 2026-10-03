import { isNativeAndroid } from './runtimePlatform.js';

// This file is used only by the Gate A harness until launch, bridge and
// microphone permission have been verified. Production speech stays Web.
let pluginPromise;
// Capacitor's Proxy synthesizes a method for any property, including `then`.
// Returning that Proxy from an async function makes it a thenable and can hang
// resolution. Expose only the actual methods in a plain, non-thenable facade.
export function nativeSpeechFacade(proxy) {
  return Object.freeze(Object.fromEntries(
    ['isAvailable', 'requestPermission', 'start', 'stop', 'cancel', 'addListener']
      .map(method => [method, (...args) => proxy[method](...args)])
  ));
}
export async function getNativeSpeech(scope = globalThis) {
  if (!isNativeAndroid(scope)) throw new Error('NativeSpeech requires the Capacitor Android shell');
  if (scope !== globalThis) return nativeSpeechFacade(scope.Capacitor.registerPlugin('NativeSpeech'));
  if (!pluginPromise) {
    // The injected native bridge does not itself export registerPlugin.
    // Staging copies the locked official ESM runtime into this relative path.
    pluginPromise = import('./capacitor-core.js').then(({ registerPlugin }) =>
      nativeSpeechFacade(registerPlugin('NativeSpeech')));
  }
  return pluginPromise;
}
