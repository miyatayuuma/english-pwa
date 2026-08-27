import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isMainRuntimeReady } from '../scripts/app/sessionShell.js';
import { isSecondaryLearningView } from '../scripts/app/learningMenu.js';

test('session shell readiness only requires loaded items and the primary CTA',()=>{
  const windowObj={ALL_ITEMS:[{id:'E0001'}]};
  const documentObj={getElementById:(id)=>id==='startStudyCta'?{}:null};
  assert.equal(isMainRuntimeReady(windowObj,documentObj),true);
  assert.equal(isMainRuntimeReady({ALL_ITEMS:[]},documentObj),false);
  assert.equal(isMainRuntimeReady(windowObj,{getElementById:()=>null}),false);
});

test('home return visibility follows study/review views without session-shell body classes',()=>{
  const nodes={
    studyView:{hidden:true},
    reviewCompleteView:{hidden:true},
  };
  const documentObj={getElementById:(id)=>nodes[id]||null};
  assert.equal(isSecondaryLearningView(documentObj),false);
  nodes.studyView.hidden=false;
  assert.equal(isSecondaryLearningView(documentObj),true);
  nodes.studyView.hidden=true;
  nodes.reviewCompleteView.hidden=false;
  assert.equal(isSecondaryLearningView(documentObj),true);
});

test('focus-shell CSS is applied only after runtime readiness',()=>{
  const source=fs.readFileSync(new URL('../scripts/app/sessionShell.js',import.meta.url),'utf8');
  const initStart=source.indexOf('async function init(){');
  assert.notEqual(initStart,-1);
  const initSource=source.slice(initStart);
  const readyIndex=initSource.indexOf('await waitForMainReady();');
  const stylesIndex=initSource.indexOf('injectStyles();');
  assert.ok(readyIndex>=0 && stylesIndex>readyIndex,'focus styles must not hide the base UI before runtime readiness');
  assert.equal(initSource.includes('createExploreDialog();'),false,'explore dialog should stay lazy during boot');
  assert.equal(source.includes('waitForMainReady(timeout='),false,'readiness must not fail because of a fixed timeout');
});

test('learning navigation does not expire while the session shell is still loading',()=>{
  const source=fs.readFileSync(new URL('../scripts/app/learningMenu.js',import.meta.url),'utf8');
  assert.equal(source.includes('waitForNav(timeout='),false);
  assert.match(source,/\.learning-home-return\.is-visible/);
});
