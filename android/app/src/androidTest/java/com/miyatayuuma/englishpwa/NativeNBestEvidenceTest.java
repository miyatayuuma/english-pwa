package com.miyatayuuma.englishpwa;

import static org.junit.Assert.*;
import android.os.Bundle;
import android.speech.SpeechRecognizer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import com.getcapacitor.JSObject;
import java.lang.reflect.Method;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class NativeNBestEvidenceTest {
    @Test
    public void providerCountsOrderRanksTranscriptsAndConfidenceSurviveNativeMapping() throws Exception {
        Method mapping=NativeSpeechPlugin.class.getDeclaredMethod("results",Bundle.class);
        mapping.setAccessible(true);
        assertEquals(20,NativeSpeechPlugin.REQUESTED_MAX_RESULTS);
        for(int count:new int[]{0,1,7,20,25}) {
            Bundle bundle=new Bundle();
            ArrayList<String> transcripts=new ArrayList<>();
            float[] confidence=new float[count];
            for(int i=0;i<count;i++){transcripts.add(i==19?"yell":"same provider transcript");confidence[i]=i==0?-1:0.25f;}
            bundle.putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION,transcripts);
            bundle.putFloatArray(SpeechRecognizer.CONFIDENCE_SCORES,confidence);
            JSObject mapped=(JSObject)mapping.invoke(new NativeSpeechPlugin(),bundle);
            assertEquals(20,mapped.getInt("requestedMaxResults"));
            assertEquals(count,mapped.getInt("providerReturnedCount"));
            JSONArray alternatives=mapped.getJSONArray("alternatives");
            assertEquals(Math.min(count,20),alternatives.length());
            for(int i=0;i<alternatives.length();i++){
                JSONObject candidate=alternatives.getJSONObject(i);
                assertEquals(i,candidate.getInt("asrRank"));
                assertEquals(transcripts.get(i),candidate.getString("transcript"));
                if(i==0)assertTrue(candidate.isNull("confidence"));
                else assertEquals(0.25,candidate.getDouble("confidence"),0.0001);
            }
        }
    }
}
