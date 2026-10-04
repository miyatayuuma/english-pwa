// This migration edits only retired feature storage. Learning state, goals,
// current method, playback speed and browser/native folder grants are untouched.
export const ZERO_SETUP_MIGRATION_KEY='zeroSetupMigrationV1';
export const RETIRED_CONFIG_FIELDS=Object.freeze([
  'apiUrl','apiKey','audioBase','speechVoice','playbackMode',
  'milestoneIntensity','resultSound','speechFallback',
]);
export const RETIRED_STORAGE_KEYS=Object.freeze([
  'pendingLogsV1','hasCompletedOnboardingV1','onboardingPlanV1',
  'onboardingPlanCollapseDateV1','notifSettingsV1',
]);
export function migrateZeroSetupStorage(storage){
  try{
    storage ??= globalThis.localStorage;
    if(!storage) return false;
    if(storage.getItem(ZERO_SETUP_MIGRATION_KEY)==='1') return true;
    const raw=storage.getItem('appConfigV3');
    if(raw){
      let config;
      try{config=JSON.parse(raw);}catch(_){config=null;}
      if(config && typeof config==='object' && !Array.isArray(config)){
        for(const field of RETIRED_CONFIG_FIELDS) delete config[field];
        storage.setItem('appConfigV3',JSON.stringify(config));
      }
    }
    for(const key of RETIRED_STORAGE_KEYS) storage.removeItem(key);
    storage.setItem(ZERO_SETUP_MIGRATION_KEY,'1');
    return true;
  }catch(_){return false;}
}
