# Zero-setup production UX

Merge dependency: Android native PR #264 must merge before this cleanup. These remain separate rollback units.

Settings now contain only folder pick, clear and status (plus close). Folder edits apply immediately. Game selection, scope/character/training, actual session count, Explore and playback speed remain in normal UI. No initial questionnaire or automatic permission request blocks Home or learning.

Actual count is still owned by sessionOptionsCore. Explicit 5/8/12/custom counts fill the plan to the requested count when eligible candidates exist, including a new-only pool; candidate/recent exclusions can produce an explained shortfall. Auto preserves the existing adaptive composition, including its two-new-item cap: cold-start new-only auto can be two items, while mixed pools typically produce 6–8. Session goals remain independent display/progress state.

Playback uses forceSpeech → TTS; otherwise folder/OPFS source → automatic TTS fallback when unresolved or unavailable. Character voice profiles/en-US selection and existing Web/native TTS controllers remain. Remote audio base and manual voices/playback are retired. Milestone default is normal with prefers-reduced-motion taking precedence; result sound is standard. Notifications use DEFAULT_NOTIFICATION_SETTINGS, never load old custom settings, and never request permission on launch. The existing permission handler requires a user gesture; no notification setup step is introduced.

One-time migration marker: zeroSetupMigrationV1. appConfigV3 deletes apiUrl/apiKey/audioBase/speechVoice/playbackMode/milestoneIntensity/resultSound/speechFallback, preserves studyMode and other unrelated fields. Deleted keys: pendingLogsV1, hasCompletedOnboardingV1, onboardingPlanV1, onboardingPlanCollapseDateV1, notifSettingsV1. All other keys are untouched, including item levels/review, studyLogV1, audioSpeedV1, recent sessions, relationship/progression, notifStateV1 and dailyGoalV1/sessionGoalV1. Browser fs-handles IndexedDB and native persisted SAF grants are untouched. Corrupt old config does not prevent retired-key cleanup or reset learning state.

GAS runtime (remote status/online flush/pending queue/srs+attempt+speech+session+shadowing sends) is removed. Local level/SRS/study history/session summary/shadowing/relationship logic remains. GAS/WebApp.gs and GAS/SRS.gs are deleted. GAS/ExportItems.gs and narrowed source-only GAS/Setup.gs remain as offline spreadsheet source-export tools and are excluded from native staging/runtime.

Physical-device accuracy/false-accept measurement belongs to #264's Deep N-best handoff; emulator/unit tests cannot substitute for it.
