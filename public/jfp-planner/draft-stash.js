/* Unsaved on the go drafts are never thrown away.
 *
 * The page always reopened its device draft, so "Create session" in My
 * sessions showed the last session again instead of a blank one. With ?new=1
 * this script, loaded in <head> before anything reads the draft, moves the
 * draft aside into a list on the device and lets the page start blank. The
 * tools panel then offers it back ("Resume your unsaved draft").
 *
 * A saved session (?plan=<id>) keeps its own per-plan draft and is left
 * alone. The pure helpers mirror lib/planner-drafts.js; the tests hold both
 * to the same vectors and drive the storage steps below with a fake device.
 */
(function (root) {
  'use strict';

  // What the portal text layer writes when a page has no edited copy. Storing
  // it (rather than removing the key) stops the page falling back to the
  // oldest, pre-team text draft on a fresh start.
  var TEXT_EMPTY = '{"text":{},"diff":{}}';

  function fingerprint(text) {
    var value = String(text == null ? '' : text);
    var a = 0x811c9dc5, b = 5381;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      a = Math.imul(a ^ code, 0x01000193) >>> 0;
      b = (Math.imul(b, 33) + code) >>> 0;
    }
    return value.length.toString(36) + '-' + a.toString(36) + '-' + b.toString(36);
  }
  function readStash(raw) {
    try {
      var list = JSON.parse(raw || '[]');
      return Array.isArray(list) ? list.filter(function (e) { return e && typeof e === 'object' && typeof e.id === 'string' && typeof e.fingerprint === 'string'; }) : [];
    } catch (e) { return []; }
  }
  // Newest first, one copy per content, no size cap (dropping the oldest
  // would be losing a coach's work).
  function addToStash(entries, entry) {
    var list = Array.isArray(entries) ? entries : [];
    for (var i = 0; i < list.length; i++) if (list[i].fingerprint === entry.fingerprint) return { entries: list, added: false };
    return { entries: [entry].concat(list), added: true };
  }
  function removeFromStash(entries, id) {
    return (Array.isArray(entries) ? entries : []).filter(function (e) { return e.id !== id; });
  }
  function needsRescue(text, clean) {
    return typeof text === 'string' && text.length > 0 && fingerprint(text) !== clean;
  }
  function withoutIntent(search, names) {
    var params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
    (names || ['new', 'plan']).forEach(function (name) { params.delete(name); });
    var rest = params.toString();
    return rest ? '?' + rest : '';
  }

  // The keys the page's own scripts restore from (editor-document.js, the
  // legacy scene reader and the portal text layer in blank.html).
  function draftKeys(page, team) {
    return {
      doc: 'jf-otg-document-' + page + '-' + team + '-draft',
      text: 'jf-otg-' + page + '-' + team + '-draft',
      scene: 'jf-otg-scene-' + page + '-' + team + '-draft',
      legacyText: 'jf-otg-' + page,
      stash: 'jf-otg-previous-drafts-' + page + '-' + team,
      clean: 'jf-otg-clean-' + page + '-' + team + '-draft'
    };
  }
  function get(storage, key) { try { return storage.getItem(key); } catch (e) { return null; } }
  function put(storage, key, value) { if (value === null || value === undefined) storage.removeItem(key); else storage.setItem(key, value); }

  // Exactly what the page would restore if it loaded normally right now.
  function readBundle(storage, keys) {
    var text = get(storage, keys.text);
    if (text === null) text = get(storage, keys.legacyText);
    return { doc: get(storage, keys.doc), text: text, scene: get(storage, keys.scene) };
  }
  function bundleIsEmpty(bundle) {
    return bundle.doc === null && (bundle.text === null || bundle.text === TEXT_EMPTY) && bundle.scene === null;
  }
  // The document carries every page, diagram and text field, so it decides:
  // safe when it matches the blank page this device started or the copy last
  // saved to My Sessions. Older drafts with no document are always kept.
  function bundleNeedsRescue(bundle, clean) {
    if (bundleIsEmpty(bundle)) return false;
    if (bundle.doc !== null) return needsRescue(bundle.doc, clean);
    return true;
  }
  function bundleTitle(bundle) {
    try {
      var doc = JSON.parse(bundle.doc || 'null');
      if (doc && typeof doc.title === 'string' && doc.title.trim()) return doc.title.trim().slice(0, 140);
    } catch (e) { /* untitled */ }
    return '';
  }

  // ok:false means the draft could not be kept, so nothing may replace it.
  function stashBundle(storage, keys, bundle, id, now) {
    if (!bundleNeedsRescue(bundle, get(storage, keys.clean))) return { ok: true, stashed: false };
    var current;
    try { current = readStash(storage.getItem(keys.stash)); } catch (e) { return { ok: false, stashed: false }; }
    var result = addToStash(current, { id: id, savedAt: now, title: bundleTitle(bundle), fingerprint: fingerprint(JSON.stringify([bundle.doc, bundle.text, bundle.scene])), bundle: bundle });
    if (!result.added) return { ok: true, stashed: false, entries: current };
    try { storage.setItem(keys.stash, JSON.stringify(result.entries)); } catch (e) { return { ok: false, stashed: false, entries: current }; }
    return { ok: true, stashed: true, entries: result.entries };
  }
  function clearDraft(storage, keys) {
    try { storage.removeItem(keys.doc); } catch (e) { /* nothing to clear */ }
    try { storage.removeItem(keys.scene); } catch (e) { /* nothing to clear */ }
    try { storage.removeItem(keys.clean); } catch (e) { /* nothing to clear */ }
    try { storage.setItem(keys.text, TEXT_EMPTY); } catch (e) { /* a full device keeps the older text */ }
  }

  // ?new=1: keep the open draft in the list, then clear the page's draft keys.
  function freshStart(storage, keys, id, now) {
    var kept = stashBundle(storage, keys, readBundle(storage, keys), id, now);
    if (!kept.ok) return { ok: false, stashed: false, reason: 'storage' };
    clearDraft(storage, keys);
    return { ok: true, stashed: kept.stashed };
  }
  // The coach said "start blank anyway" after being told the draft cannot be kept.
  function forceFresh(storage, keys) { clearDraft(storage, keys); return { ok: true, stashed: false }; }

  // Swap a listed draft back in. What is open now joins the list first, and
  // the resumed draft leaves the list only once it is back in the draft keys.
  function resume(storage, keys, entryId, id, now) {
    var entry = null;
    readStash(get(storage, keys.stash)).forEach(function (e) { if (e.id === entryId) entry = e; });
    if (!entry || !entry.bundle) return { ok: false, reason: 'missing' };
    var kept = stashBundle(storage, keys, readBundle(storage, keys), id, now);
    if (!kept.ok) return { ok: false, reason: 'storage' };
    try {
      put(storage, keys.doc, entry.bundle.doc);
      put(storage, keys.text, entry.bundle.text === null ? TEXT_EMPTY : entry.bundle.text);
      put(storage, keys.scene, entry.bundle.scene);
      storage.removeItem(keys.clean);
    } catch (e) { return { ok: false, reason: 'storage' }; }
    var after = removeFromStash(readStash(get(storage, keys.stash)), entryId);
    try { if (after.length) storage.setItem(keys.stash, JSON.stringify(after)); else storage.removeItem(keys.stash); } catch (e) { /* stays listed, harmless */ }
    return { ok: true };
  }
  function discard(storage, keys, entryId) {
    var after = removeFromStash(readStash(get(storage, keys.stash)), entryId);
    try { if (after.length) storage.setItem(keys.stash, JSON.stringify(after)); else storage.removeItem(keys.stash); return true; } catch (e) { return false; }
  }
  function markClean(storage, keys, text) {
    try { storage.setItem(keys.clean, fingerprint(text)); } catch (e) { /* private mode */ }
  }
  function listDrafts(storage, keys) { return readStash(get(storage, keys.stash)); }

  var api = {
    TEXT_EMPTY: TEXT_EMPTY, fingerprint: fingerprint, readStash: readStash, addToStash: addToStash,
    removeFromStash: removeFromStash, needsRescue: needsRescue, withoutIntent: withoutIntent,
    draftKeys: draftKeys, readBundle: readBundle, freshStart: freshStart, forceFresh: forceFresh,
    resume: resume, discard: discard, markClean: markClean, listDrafts: listDrafts,
    locked: false, fresh: null
  };
  root.JonerDraftStash = api;

  // ---- in the page ----
  if (!root.document || !root.location) return;
  var storage;
  try { storage = root.localStorage; } catch (e) { return; }
  if (!storage) return;
  var params = new URLSearchParams(root.location.search);
  if (params.get('plan')) return;
  var page = root.location.pathname.split('/').pop() || 'page';
  var keys = draftKeys(page, params.get('team') || 'local');
  var newId = function () { return 'draft-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); };
  var now = function () { return new Date().toISOString(); };
  var cleanUrl = function () { return root.location.pathname + withoutIntent(root.location.search, ['new']) + root.location.hash; };

  if (params.get('new') === '1') {
    api.fresh = freshStart(storage, keys, newId(), now());
    // A reload must not start yet another blank session.
    try { root.history.replaceState(null, '', cleanUrl()); } catch (e) { /* address bar only */ }
  }
  var hadDraft = get(storage, keys.doc) !== null;

  // editor-document.js calls this once the page has written its first draft.
  // A blank page nobody has touched yet is not work worth keeping.
  api.documentReady = function (key) {
    if (key !== keys.doc) return;
    if (hadDraft && !(api.fresh && api.fresh.ok)) return;
    var raw = get(storage, keys.doc);
    if (raw !== null) markClean(storage, keys, raw);
  };
  // Called after Save to My Sessions: this exact document is in the library.
  api.markSaved = function (text) { markClean(storage, keys, text); };

  // Reload onto the swapped draft. Autosave stays locked until the page is
  // gone, so the draft on screen cannot be written back over the swap.
  function reload() {
    api.locked = true;
    var target = cleanUrl();
    if (target === root.location.pathname + root.location.search + root.location.hash) root.location.reload();
    else root.location.replace(target);
  }
  function button(label, primary, onClick) {
    var b = root.document.createElement('button');
    b.type = 'button'; b.textContent = label;
    if (primary) b.className = 'go';
    b.addEventListener('click', onClick);
    return b;
  }
  function when(value) {
    var date = new Date(value);
    return isNaN(date.getTime()) ? '' : date.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }
  var asking = '', message = '';
  function render() {
    var d = root.document, jb = d.getElementById('jb');
    if (!jb) return;
    var box = d.getElementById('jf-previous-drafts');
    if (!box) {
      box = d.createElement('section');
      box.id = 'jf-previous-drafts';
      box.setAttribute('aria-live', 'polite');
      var anchor = d.getElementById('jf-download-document');
      if (anchor && anchor.parentNode === jb) anchor.after(box); else jb.appendChild(box);
    }
    while (box.firstChild) box.removeChild(box.firstChild);
    var drafts = listDrafts(storage, keys);
    var failed = api.fresh && !api.fresh.ok;
    box.hidden = !drafts.length && !failed && !message;
    if (box.hidden) return;
    var heading = d.createElement('h5');
    heading.textContent = 'Unsaved draft';
    box.append(heading);
    function line(text) { var p = d.createElement('p'); p.textContent = text; box.append(p); }
    if (message) line(message);
    if (failed) {
      line('Device storage is full, so your unsaved draft is still open. Save it to My Sessions or download a backup, then start a new session.');
      if (asking === 'force') {
        line('Starting blank replaces the open draft on this device. It cannot be brought back.');
        box.append(button('Start blank', true, function () { forceFresh(storage, keys); reload(); }), button('Keep my draft', false, function () { asking = ''; render(); }));
      } else {
        box.append(button('Start blank anyway', false, function () { asking = 'force'; render(); }));
      }
      if (!drafts.length) return;
    }
    if (!drafts.length) return;
    var latest = drafts[0], older = drafts.length - 1;
    if (api.fresh && api.fresh.stashed && !failed) line('New blank session started. Your previous draft is kept here.');
    line('"' + (latest.title || 'Untitled session') + '"' + (when(latest.savedAt) ? ', put aside ' + when(latest.savedAt) : '') + '.' + (older > 0 ? ' ' + older + ' older ' + (older === 1 ? 'draft is' : 'drafts are') + ' kept too.' : ''));
    if (asking === latest.id) {
      line('Delete this draft from this device? It is not in My Sessions, so it cannot be brought back.');
      box.append(button('Delete it', true, function () {
        asking = '';
        message = discard(storage, keys, latest.id) ? 'Draft deleted.' : 'Could not delete that draft.';
        render();
      }), button('Keep it', false, function () { asking = ''; render(); }));
      return;
    }
    box.append(button('Resume your unsaved draft', true, function () {
      // Flush the open page first so what is on screen is what joins the list.
      try { root.__jfDocument && root.__jfDocument.persist(); } catch (e) { /* storage full */ }
      var result = resume(storage, keys, latest.id, newId(), now());
      if (result.ok) { reload(); return; }
      message = result.reason === 'missing' ? 'That draft is no longer on this device.' : 'This device could not switch drafts. Nothing has changed; save or download this session and try again.';
      render();
    }), button('Delete draft', false, function () { asking = latest.id; render(); }));
  }
  root.document.addEventListener('DOMContentLoaded', render);
})(typeof window !== 'undefined' ? window : globalThis);
