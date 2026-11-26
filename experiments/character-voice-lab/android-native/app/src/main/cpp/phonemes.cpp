/* SPDX-License-Identifier: GPL-3.0-or-later */
#include <espeak-ng/speak_lib.h>
#include <jni.h>
#include <mutex>
#include <string>

namespace {
std::mutex espeak_lock;
bool initialized = false;

void fail(JNIEnv* env, const char* message) {
    env->ThrowNew(env->FindClass("java/lang/IllegalStateException"), message);
}
}

extern "C" JNIEXPORT void JNICALL
Java_jp_miyatayuuma_kokorop37_Phonemizer_initialize(JNIEnv* env, jclass, jstring path) {
    std::lock_guard<std::mutex> guard(espeak_lock);
    if (initialized) return;
    const char* directory = env->GetStringUTFChars(path, nullptr);
    if (!directory) return;
    const int rate = espeak_Initialize(AUDIO_OUTPUT_SYNCHRONOUS, 0, directory, espeakINITIALIZE_DONT_EXIT);
    env->ReleaseStringUTFChars(path, directory);
    if (rate <= 0) {
        fail(env, "eSpeak NG data could not be loaded");
        return;
    }
    initialized = true;
}

extern "C" JNIEXPORT jbyteArray JNICALL
Java_jp_miyatayuuma_kokorop37_Phonemizer_ipa(
        JNIEnv* env, jclass, jbyteArray utf8, jstring accent) {
    std::lock_guard<std::mutex> guard(espeak_lock);
    const char* voice = env->GetStringUTFChars(accent, nullptr);
    if (!voice) return nullptr;
    espeak_VOICE selector{};
    selector.languages = voice;
    const bool voice_ok = initialized && espeak_SetVoiceByProperties(&selector) == EE_OK;
    env->ReleaseStringUTFChars(accent, voice);
    if (!voice_ok) {
        fail(env, "eSpeak NG accent unavailable");
        return nullptr;
    }

    std::string input(env->GetArrayLength(utf8), '\0');
    env->GetByteArrayRegion(utf8, 0, input.size(), reinterpret_cast<jbyte*>(input.data()));
    if (env->ExceptionCheck()) return nullptr;
    const void* next = input.c_str();
    std::string output;
    while (next) {
        const void* before = next;
        const char* part = espeak_TextToPhonemes(&next, espeakCHARS_UTF8, espeakPHONEMES_IPA);
        if (part && *part) {
            if (!output.empty()) output += ' ';
            output += part;
        }
        if (before == next) {
            fail(env, "eSpeak NG failed to advance");
            return nullptr;
        }
    }
    auto result = env->NewByteArray(output.size());
    if (result) env->SetByteArrayRegion(result, 0, output.size(), reinterpret_cast<const jbyte*>(output.data()));
    return result;
}
