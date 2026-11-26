package jp.miyatayuuma.kokorop37;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public final class EngineSmokeTest {
    @Test public void nativePhonemizerProducesUsAndUkIpa() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        var assets = new LabAssets(context);
        var phonemizer = new Phonemizer(assets.prepareData(new LabRun()));
        String us = phonemizer.convert("Park the car.", "en-us");
        String uk = phonemizer.convert("Park the car.", "en-gb");
        assertTrue(us.endsWith("."));
        assertTrue(uk.endsWith("."));
        assertNotEquals(us, uk);
    }

    @Test public void q8RunsNativeOrtForUsAndUkVoices() throws Exception {
        var context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        var assets = new LabAssets(context);
        var run = new LabRun();
        var data = assets.prepareData(run);
        var model = assets.model("q8", run, ignored -> {});
        var tokenizer = assets.fetch("tokenizer.json", run, ignored -> {});
        var config = new KokoroEngine.Config("q8", 2, false);
        try (var engine = new KokoroEngine(config, model, tokenizer, data)) {
            engine.preload(assets, run);
            for (String character : new String[]{"jennifer", "ted"}) {
                var sample = engine.synthesize("I found it.", null, assets.voices.get(character), run);
                assertFalse(sample.phonemes().isBlank());
                assertTrue(sample.pcm().length >= 2_400);
                assertTrue(sample.pcm().length < 240_000);
            }
        }
    }
}
