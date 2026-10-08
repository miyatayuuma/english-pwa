import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {chromium} from 'playwright';

const root=path.resolve(new URL('..',import.meta.url).pathname);
const AUDIO_FILE='01 Section 1_01.m4a';
let browser,server,url;

before(async()=>{
  server=http.createServer(async(req,res)=>{
    try{
      const name=new URL(req.url,'http://localhost').pathname;
      const file=path.join(root,name==='/'?'index.html':name);
      res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/html');
      res.end(await fs.readFile(file));
    }catch(_){res.statusCode=404;res.end();}
  });
  try{
    await new Promise((resolve,reject)=>{
      server.once('error',reject);
      server.listen(0,'127.0.0.1',resolve);
    });
  }catch(_){server=null;return;}
  url=`http://127.0.0.1:${server.address().port}`;
  try{browser=await chromium.launch({headless:true,timeout:5000});}catch(error){if(process.env.REORDER_REQUIRE_BROWSER)throw error;}
});
after(async()=>{await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));});

function browserTest(name,run){
  test(name,async t=>{if(!browser)return t.skip('Chromium unavailable');await run();});
}

async function openApp({saved=false,permission='granted',nextPermission='granted'}={}){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844},reducedMotion:'reduce'});
  await context.addInitScript(({permission,nextPermission,audioFile})=>{
    window.__dirPermissionState=permission;
    window.__dirNextPermission=nextPermission;
    window.__dirQueryCalls=0;
    window.__dirRequestCalls=0;
    window.__folderPickerCalls=0;
    const installPermissionMocks=()=>{
      const target=globalThis.FileSystemHandle?.prototype||globalThis.FileSystemDirectoryHandle?.prototype;
      if(!target)return;
      Object.defineProperty(target,'queryPermission',{configurable:true,value:async()=>{
        window.__dirQueryCalls++;
        return window.__dirPermissionState;
      }});
      Object.defineProperty(target,'requestPermission',{configurable:true,value:async()=>{
        window.__dirRequestCalls++;
        if(!navigator.userActivation?.isActive)throw new DOMException('Must be called from a user gesture','InvalidStateError');
        window.__dirPermissionState=window.__dirNextPermission;
        return window.__dirPermissionState;
      }});
    };
    installPermissionMocks();
    Object.defineProperty(window,'showDirectoryPicker',{configurable:true,value:async()=>{
      window.__folderPickerCalls++;
      const root=await navigator.storage.getDirectory();
      return root.getDirectoryHandle('selected-audio',{create:true});
    }});
    window.__folderRestoreAudioFile=audioFile;
  },{permission,nextPermission,audioFile:AUDIO_FILE});
  const page=await context.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  if(saved){
    await page.goto(url+'/seed');
    await page.evaluate(async audioFile=>{
      const root=await navigator.storage.getDirectory();
      const dir=await root.getDirectoryHandle('selected-audio',{create:true});
      const file=await dir.getFileHandle(audioFile,{create:true});
      const writer=await file.createWritable();
      await writer.write(new Uint8Array([73,68,51,0]));
      await writer.close();
      await new Promise((resolve,reject)=>{
        const request=indexedDB.open('fs-handles',1);
        request.onupgradeneeded=()=>request.result.createObjectStore('dir');
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const db=request.result;
          const tx=db.transaction('dir','readwrite');
          tx.objectStore('dir').put(dir,'audio');
          tx.oncomplete=()=>{db.close();resolve();};
          tx.onerror=()=>reject(tx.error);
        };
      });
    },AUDIO_FILE);
  }
  await page.goto(url+'/index.html');
  await page.waitForFunction(()=>window.ALL_ITEMS?.length&&document.querySelector('#sessionShellStyles')&&typeof window.__OPEN_SESSION_OPTIONS__==='function');
  await page.waitForFunction(()=>!document.querySelector('#loadingOverlay')?.classList.contains('show'));
  return {context,page,errors};
}

async function savedHandleMatchesSelectedFolder(page){
  return page.evaluate(async()=>{
    const root=await navigator.storage.getDirectory();
    const expected=await root.getDirectoryHandle('selected-audio');
    const request=indexedDB.open('fs-handles',1);
    const saved=await new Promise((resolve,reject)=>{
      request.onerror=()=>reject(request.error);
      request.onsuccess=()=>{
        const db=request.result;
        const get=db.transaction('dir','readonly').objectStore('dir').get('audio');
        get.onsuccess=()=>{db.close();resolve(get.result||null);};
        get.onerror=()=>reject(get.error);
      };
    });
    return !!saved&&await saved.isSameEntry(expected);
  });
}

async function startDefaultSession(page){
  await page.locator('.friendship-hero__cta').click();
  await page.waitForFunction(()=>!document.querySelector('#studyView')?.hidden);
}

browserTest('saved granted directory restores on boot and supplies audio without permission or picker',async()=>{
  const {context,page,errors}=await openApp({saved:true,permission:'granted'});
  try{
    assert.equal(await page.locator('#dirStatus').textContent(),'保存済み');
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),0);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.equal(await savedHandleMatchesSelectedFolder(page),true);
    await startDefaultSession(page);
    await page.waitForFunction(()=>document.querySelector('audio')?.dataset.srcKey?.startsWith('blob:'));
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),0);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

browserTest('saved prompt directory waits silently at boot and reacquires permission on the start gesture',async()=>{
  const {context,page,errors}=await openApp({saved:true,permission:'prompt',nextPermission:'granted'});
  try{
    assert.equal(await page.locator('#dirStatus').textContent(),'許可待ち');
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),0);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.equal(await savedHandleMatchesSelectedFolder(page),true);
    await startDefaultSession(page);
    await page.waitForFunction(()=>document.querySelector('audio')?.dataset.srcKey?.startsWith('blob:'));
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),1);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.equal(await page.locator('#dirStatus').textContent(),'保存済み');
    assert.equal(await savedHandleMatchesSelectedFolder(page),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

browserTest('session-options submit requests saved-folder permission before its deferred session launch',async()=>{
  const {context,page,errors}=await openApp({saved:true,permission:'prompt',nextPermission:'granted'});
  try{
    await page.evaluate(()=>window.__OPEN_SESSION_OPTIONS__());
    await page.locator('#playOptionsStart').click();
    await page.waitForFunction(()=>!document.querySelector('#studyView')?.hidden);
    await page.waitForFunction(()=>document.querySelector('audio')?.dataset.srcKey?.startsWith('blob:'));
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),1);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

browserTest('denied saved permission keeps the handle and starts with audio fallback',async()=>{
  const {context,page,errors}=await openApp({saved:true,permission:'prompt',nextPermission:'denied'});
  try{
    assert.equal(await page.locator('#dirStatus').textContent(),'許可待ち');
    await startDefaultSession(page);
    assert.equal(await page.locator('#dirStatus').textContent(),'権限なし');
    assert.equal(await savedHandleMatchesSelectedFolder(page),true);
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),1);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

browserTest('saved denied handle is reused if permission is later restored outside the app',async()=>{
  const {context,page,errors}=await openApp({saved:true,permission:'denied'});
  try{
    assert.equal(await page.locator('#dirStatus').textContent(),'権限なし');
    await page.evaluate(()=>{window.__dirPermissionState='granted';});
    await startDefaultSession(page);
    await page.waitForFunction(()=>document.querySelector('audio')?.dataset.srcKey?.startsWith('blob:'));
    assert.equal(await page.locator('#dirStatus').textContent(),'保存済み');
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),0);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.equal(await savedHandleMatchesSelectedFolder(page),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

browserTest('no saved directory boots without picker or permission request',async()=>{
  const {context,page,errors}=await openApp();
  try{
    assert.equal(await page.locator('#dirStatus').textContent(),'未設定');
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),0);
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    await startDefaultSession(page);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});

browserTest('explicit selection refreshes current audio and explicit clear removes the saved handle',async()=>{
  const {context,page,errors}=await openApp();
  try{
    await startDefaultSession(page);
    await page.locator('#btnCfg').click();
    await page.locator('#btnPickDir').click();
    await page.waitForFunction(()=>document.querySelector('audio')?.dataset.srcKey?.startsWith('blob:'));
    assert.equal(await page.locator('#dirStatus').textContent(),'保存済み');
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),1);
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),0);
    assert.equal(await savedHandleMatchesSelectedFolder(page),true);
    await page.reload();
    await page.waitForFunction(()=>window.ALL_ITEMS?.length&&typeof window.__OPEN_SESSION_OPTIONS__==='function');
    await page.waitForFunction(()=>!document.querySelector('#loadingOverlay')?.classList.contains('show'));
    assert.equal(await page.locator('#dirStatus').textContent(),'保存済み');
    assert.equal(await page.evaluate(()=>window.__folderPickerCalls),0);
    assert.equal(await page.evaluate(()=>window.__dirRequestCalls),0);
    assert.equal(await savedHandleMatchesSelectedFolder(page),true);
    await startDefaultSession(page);
    await page.waitForFunction(()=>document.querySelector('audio')?.dataset.srcKey?.startsWith('blob:'));
    await page.locator('#btnCfg').click();
    await page.locator('#btnClearDir').click();
    assert.equal(await page.locator('#dirStatus').textContent(),'未設定');
    assert.equal(await page.evaluate(()=>{
      const request=indexedDB.open('fs-handles',1);
      return new Promise((resolve,reject)=>{
        request.onerror=()=>reject(request.error);
        request.onsuccess=()=>{
          const db=request.result;const get=db.transaction('dir','readonly').objectStore('dir').get('audio');
          get.onsuccess=()=>{db.close();resolve(get.result===undefined);};get.onerror=()=>reject(get.error);
        };
      });
    }),true);
    assert.deepEqual(errors,[]);
  }finally{await context.close();}
});
