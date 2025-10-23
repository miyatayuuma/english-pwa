import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createDrillPanel } from '../scripts/app/drill.js';

class MockElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.attributes = new Map();
    this.eventListeners = new Map();
    this.className = '';
    this.textContent = '';
    this.hidden = false;
    this.parentNode = null;
    this.ownerDocument = null;
  }

  get firstChild() {
    return this.children.length ? this.children[0] : null;
  }

  appendChild(child) {
    if (!child) return child;
    this.children.push(child);
    child.parentNode = this;
    return child;
  }

  removeChild(child) {
    const idx = this.children.indexOf(child);
    if (idx >= 0) {
      this.children.splice(idx, 1);
      child.parentNode = null;
    }
    return child;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, handler) {
    this.eventListeners.set(type, handler);
  }

  set innerHTML(value) {
    this.children = [];
    this.textContent = typeof value === 'string' ? value : '';
  }

  get innerHTML() {
    return this.textContent;
  }
}

class MockDocument {
  createElement(tag) {
    const el = new MockElement(tag);
    el.ownerDocument = this;
    return el;
  }
}

test('drill panel renders phonetic and definition data', async () => {
  const previousDocument = globalThis.document;
  const mockDocument = new MockDocument();
  const root = new MockElement('div');
  root.ownerDocument = mockDocument;
  globalThis.document = mockDocument;

  try {
    const dictionaryCalls = [];
    const panel = createDrillPanel({
      root,
      dictionaryClient: {
        async lookup(term) {
          dictionaryCalls.push(term);
          return {
            term,
            phonetic: '/example/',
            definitions: ['An illustrative instance'],
            audioUrls: ['https://example.test/audio.mp3'],
            source: 'remote',
          };
        },
      },
      speakFallback: () => false,
    });

    await panel.loadItem({ id: 'card-1', en: 'Example' });

    const state = panel.getDebugState();
    assert.equal(state.term, 'Example');
    assert.equal(state.phonetic, '/example/');
    assert.deepEqual(state.definitions, ['An illustrative instance']);
    assert.equal(root.hidden, false);
    assert.deepEqual(dictionaryCalls, ['Example']);

    panel.handleResult({ pass: false, missingTokens: ['Example'] });
    const feedbackState = panel.getDebugState();
    assert.ok(/意味/.test(feedbackState.feedback) || feedbackState.feedback.includes('An illustrative instance'));
  } finally {
    globalThis.document = previousDocument;
  }
});
