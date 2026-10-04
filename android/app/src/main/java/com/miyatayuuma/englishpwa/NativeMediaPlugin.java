package com.miyatayuuma.englishpwa;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.DocumentsContract;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;

@CapacitorPlugin(name="NativeMedia")
public class NativeMediaPlugin extends Plugin {
    private TextToSpeech tts;
    private boolean ready;
    private boolean failed;
    private String activeId;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private android.content.SharedPreferences prefs() { return getContext().getSharedPreferences("native-media", 0); }
    @Override public void load() {
        getActivity().runOnUiThread(() -> {
            tts = new TextToSpeech(getContext(), status -> {
                ready = status == TextToSpeech.SUCCESS;
                failed = !ready;
                notifyListeners("voiceschanged", new JSObject());
            });
            tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                public void onStart(String id) { event(id,"start"); }
                public void onDone(String id) { event(id,"end"); }
                public void onError(String id) { event(id,"error"); }
                public void onStop(String id, boolean interrupted) { event(id,"error"); }
            });
        });
    }
    private void event(String id, String type) {
        getActivity().runOnUiThread(() -> {
            if (!Objects.equals(id,activeId)) return;
            JSObject result=new JSObject();result.put("id",id);result.put("type",type);
            notifyListeners("tts",result);
            if (!type.equals("start")) activeId=null;
        });
    }
    @PluginMethod public void voices(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSArray voices=new JSArray();
            if (ready && tts.getVoices()!=null) for(Voice voice:tts.getVoices()) {
                JSObject row=new JSObject();row.put("name",voice.getName());row.put("voiceURI",voice.getName());
                row.put("lang",voice.getLocale().toLanguageTag());row.put("localService",!voice.isNetworkConnectionRequired());voices.put(row);
            }
            JSObject result=new JSObject();result.put("voices",voices);result.put("ready",ready);result.put("failed",failed);call.resolve(result);
        });
    }
    @PluginMethod public void speak(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (!ready) { call.reject(failed?"TTS engine unavailable":"TTS engine initializing", "TTS_UNAVAILABLE");return; }
            String text=call.getString("text","");
            String id=call.getString("id","");
            if(text.isEmpty() || id.isEmpty()) {call.reject("text/id required");return;}
            tts.stop(); activeId=null;
            int language=tts.setLanguage(Locale.US);
            if(language<0) {call.reject("Install English TTS voice data", "TTS_LANGUAGE_UNAVAILABLE");return;}
            String voiceId=call.getString("voice","");
            if(!voiceId.isEmpty() && tts.getVoices()!=null) for(Voice voice:tts.getVoices()) if(voice.getName().equals(voiceId)) tts.setVoice(voice);
            tts.setSpeechRate(call.getFloat("rate",1f));tts.setPitch(call.getFloat("pitch",1f));
            Bundle params=new Bundle();params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME,call.getFloat("volume",1f));
            activeId=id;
            if(tts.speak(text,TextToSpeech.QUEUE_FLUSH,params,id)==TextToSpeech.ERROR) {activeId=null;call.reject("TTS speak failed");} else call.resolve();
        });
    }
    @PluginMethod public void cancel(PluginCall call) { getActivity().runOnUiThread(() -> {activeId=null;if(tts!=null) tts.stop();call.resolve();}); }
    @PluginMethod public void pick(PluginCall call) {
        Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call,intent,"picked");
    }
    @ActivityCallback private void picked(PluginCall call, ActivityResult result) {
        if(call==null) return;
        Intent data=result.getData();
        if(result.getResultCode()!=Activity.RESULT_OK || data==null || data.getData()==null) {call.reject("Folder selection cancelled","CANCELLED");return;}
        try {
            Uri uri=data.getData();
            getContext().getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            String old=prefs().getString("tree","");
            prefs().edit().putString("tree",uri.toString()).apply();
            if(!old.equals(uri.toString())) release(old);
            status(call);
        } catch(Exception error) {call.reject("Cannot retain folder permission",error);}
    }
    private void release(String value) {
        if(value.isEmpty()) return;
        try {getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(value),Intent.FLAG_GRANT_READ_URI_PERMISSION);} catch(SecurityException ignored) { }
    }
    @PluginMethod public void clear(PluginCall call) {release(prefs().getString("tree",""));prefs().edit().remove("tree").apply();call.resolve();}
    @PluginMethod public void status(PluginCall call) {
        String tree=prefs().getString("tree","");boolean granted=false;
        for(android.content.UriPermission permission:getContext().getContentResolver().getPersistedUriPermissions()) if(permission.getUri().toString().equals(tree)&&permission.isReadPermission()) granted=true;
        JSObject result=new JSObject();result.put("selected",!tree.isEmpty());result.put("granted",granted);call.resolve(result);
    }
    @PluginMethod public void read(PluginCall call) {
        io.execute(() -> {
            try {
                String name=call.getString("name","");
                if(name.isEmpty() || name.contains("/") || name.contains("\\") || name.equals("..")) throw new IOException("Invalid filename");
                String stored=prefs().getString("tree","");if(stored.isEmpty()) {call.reject("Select audio folder","NO_FOLDER");return;}
                Uri tree=Uri.parse(stored);
                Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(tree,DocumentsContract.getTreeDocumentId(tree));
                Uri file=null;
                try(Cursor cursor=getContext().getContentResolver().query(children,new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)) {
                    if(cursor!=null) while(cursor.moveToNext()) if(name.equals(cursor.getString(1))) {file=DocumentsContract.buildDocumentUriUsingTree(tree,cursor.getString(0));break;}
                }
                if(file==null) {call.reject("Audio file not found","NOT_FOUND");return;}
                // Bridge-safe bounded blob, not content:// exposure or broad storage access.
                try(InputStream input=getContext().getContentResolver().openInputStream(file);ByteArrayOutputStream output=new ByteArrayOutputStream()) {
                    if(input==null) throw new IOException("Cannot open audio");
                    byte[] buffer=new byte[8192];int count;
                    while((count=input.read(buffer))!=-1) {if(output.size()+count>32*1024*1024) throw new IOException("Audio exceeds 32 MiB");output.write(buffer,0,count);}
                    JSObject row=new JSObject();row.put("base64",android.util.Base64.encodeToString(output.toByteArray(),android.util.Base64.NO_WRAP));
                    String mime=getContext().getContentResolver().getType(file);row.put("mime",mime==null?"audio/mpeg":mime);call.resolve(row);
                }
            } catch(Exception error) {call.reject("Cannot read audio; reselect folder if permission was revoked",error);}
        });
    }
    @Override protected void handleOnPause() {getActivity().runOnUiThread(() -> {if(activeId!=null) event(activeId,"error");if(tts!=null) tts.stop();});}
    @Override protected void handleOnDestroy() {io.shutdownNow();getActivity().runOnUiThread(() -> {activeId=null;if(tts!=null) {tts.stop();tts.shutdown();}});}
}
