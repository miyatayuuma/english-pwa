import { isNativeAndroid } from './runtimePlatform.js';

// This file is used only by the Gate A harness until launch, bridge and
// microphone permission have been verified. Production speech stays Web.
let plugin;
export async function getNativeSpeech(scope = globalThis) {
  if (!isNativeAndroid(scope)) throw new Error('NativeSpeech requires the Capacitor Android shell');
  if (scope !== globalThis) return scope.Capacitor.registerPlugin('NativeSpeech');
  if (!plugin) {
    // The injected native bridge does not itself export registerPlugin.
    // Staging copies the locked official ESM runtime into this relative path.
    const { registerPlugin } = await import('./capacitor-core.js');
    plugin = registerPlugin('NativeSpeech');
  }
  return plugin;
}
