/* Shared document persistence for every On-the-Go template. */
(function () {
  window.JonerDocument = {
    install: function (api) {
      const { D, S, PANELS, svgs } = api;
      const params = new URLSearchParams(location.search);
      const key = 'jf-otg-document-' + location.pathname.split('/').pop() + '-' + (params.get('team') || 'local') + '-' + (params.get('plan') || 'draft');
      let restoring = false, ready = false, timer;
      const pages = () => Array.from(document.querySelectorAll('.page'));
      const fields = page => Array.from(page.querySelectorAll('[data-jf-edit]'));
      const panelNames = page => PANELS.filter(name => svgs[name]?.closest('.page') === page);
      const difficulty = page => page.querySelector('.jf-diff-toggle .pips')?.querySelectorAll('i.on').length || 2;
      const status = document.createElement('p');
      status.id = 'jf-device-status'; status.setAttribute('role', 'status');
      document.getElementById('jf-save-cloud').after(status);
      const isPlayer = item => item?.k === 'eq' && /^pl/.test(item.id || '');
      const selectedPlayer = () => {
        const selected = document.querySelector('.jbhit.jb-sel[data-p][data-i]');
        const panel = selected?.dataset.p || S.panel;
        const index = selected ? Number(selected.dataset.i) : S.sel;
        const item = D.scene[panel]?.items?.[index];
        const looksLikePlayer = selected?.querySelector('use[href^="#pl"], ellipse[cx="0"][cy="31"]');
        return isPlayer(item) || (item?.k === 'eq' && looksLikePlayer) ? item : null;
      };
      const remember = () => {
        S.undo.push(JSON.stringify(D.scene));
        if (S.undo.length > 60) S.undo.shift();
      };
      const isClassicArtwork = () => document.documentElement.dataset.plannerArtwork !== 'illustrated';
      const underlyingDisplay = () => document.getElementById('jf-playermode')?.textContent.includes('numbers') ? 'number' : 'figure';
      // Classic is intentionally a tactics board. Keep the last Realistic
      // choice separately so changing artwork never alters a saved pose or
      // turns a coach's previous Figures choice into data loss.
      const existingDisplay = () => isClassicArtwork() ? 'number' : underlyingDisplay();
      const setPlayerDisplay = mode => {
        const wanted = mode === 'number' ? 'number' : 'figure';
        const toggle = document.getElementById('jf-playermode');
        document.documentElement.dataset.realisticPlayerDisplay = wanted;
        if (!isClassicArtwork() && toggle && underlyingDisplay() !== wanted) toggle.click();
        document.documentElement.dataset.playerDisplay = isClassicArtwork() ? 'number' : wanted;
        syncPlayerControls();
      };
      const rotatePlayers = () => {
        document.querySelectorAll('.jbhit[data-p][data-i]').forEach(node => {
          const item = D.scene[node.dataset.p]?.items?.[Number(node.dataset.i)];
          if (!isPlayer(item) || !Number.isFinite(Number(item.r)) || !Number(item.r)) {
            node.removeAttribute('transform');
            return;
          }
          node.setAttribute('transform', `rotate(${Number(item.r)} ${Number(item.x)} ${Number(item.y)})`);
        });
      };
      let playerControls;
      function syncPlayerControls() {
        if (!playerControls) return;
        const player = selectedPlayer();
        const classic = isClassicArtwork();
        playerControls.querySelectorAll('[data-player-control]').forEach(control => { control.disabled = !player; });
        const choice = playerControls.querySelector('.jf-player-choice');
        if (choice) choice.hidden = classic;
        const displayNote = playerControls.querySelector('[data-player-display-note]');
        if (displayNote) displayNote.hidden = !classic;
        playerControls.querySelector('[data-player-display="figure"]')?.setAttribute('aria-pressed', String(!classic && existingDisplay() === 'figure'));
        playerControls.querySelector('[data-player-display="number"]')?.setAttribute('aria-pressed', String(!classic && existingDisplay() === 'number'));
        const number = playerControls.querySelector('[data-player-number]');
        const size = playerControls.querySelector('[data-player-size]');
        const rotation = playerControls.querySelector('[data-player-rotation]');
        if (number) number.value = player?.n ?? '';
        if (size) size.value = String(player?.s ?? 1);
        if (rotation) rotation.value = String(player?.r ?? 0);
        const hint = playerControls.querySelector('[data-player-hint]');
        if (hint) hint.textContent = player ? 'Editing selected player' : 'Select a player on a diagram to edit it';
      }
      function changePlayer(change) {
        const player = selectedPlayer();
        if (!player) return;
        remember();
        change(player);
        api.paint();
      }

      function fitTitles() {
        document.querySelectorAll('.titlestrip .tt h1').forEach(title => {
          const slot=title.parentElement, available=slot.clientHeight-6;
          title.style.fontSize='25px';
          for(let size=24;size>=12 && (title.scrollHeight>available || title.scrollWidth>slot.clientWidth-22);size--)title.style.fontSize=size+'px';
        });
      }
      window.addEventListener('beforeprint',fitTitles);
      window.addEventListener('resize',fitTitles);
      document.fonts?.ready.then(fitTitles);
      document.addEventListener('input',()=>requestAnimationFrame(fitTitles));
      function snapshot() {
        const text = {}, scene = {};
        let fieldId=0;
        const records=pages().map((page,index)=>{
          const panels=panelNames(page).map((old,i)=>{
            const name=['setup','inplay','progression'][i]+(index?'_p'+(index+1):'');
            scene[name]=JSON.parse(JSON.stringify(D.scene[old]));return name;
          });
          const copy=fields(page).map(el=>{text[String(fieldId++)]=el.innerHTML;return el.innerHTML;});
          return {panels,text:copy,difficulty:difficulty(page)};
        });
        return {version:1,template:location.pathname.split('/').pop(),scene,text,difficulty:records.map(r=>r.difficulty),pages:records,
          title:document.querySelector('[aria-label="Session name"]')?.value||'',artwork:document.documentElement.dataset.plannerArtwork||'classic',playerDisplay:document.documentElement.dataset.realisticPlayerDisplay||existingDisplay()};
      }
      function persist() {
        clearTimeout(timer);
        // Locked while draft-stash.js swaps drafts and reloads the page.
        if (!ready || restoring || window.JonerDraftStash?.locked) return;
        try { localStorage.setItem(key, JSON.stringify(snapshot())); status.textContent = 'Device draft saved'; }
        catch { status.textContent = 'Device storage unavailable. Save to My Sessions or download your session.'; }
      }
      function schedule() { if (!ready || restoring) return; clearTimeout(timer); timer = setTimeout(persist, 160); }
      function restore(saved) {
        if (!saved?.scene) throw Error('This session has no editable diagram data.');
        restoring = true;
        try {
          let records = saved.pages;
          if (!Array.isArray(records) || !records.length) {
            // Older saves stored added panels and numbered text fields, but no page list.
            const bases = Object.keys(saved.scene).filter(n => /^setup(?:_p\d+)?$/.test(n)).sort((a,b) => (Number(a.split('_p')[1]) || 1) - (Number(b.split('_p')[1]) || 1));
            const perPage = fields(pages()[0]).length;
            records = bases.map((base, index) => {
              const suffix = base.slice(5), n = Number(base.split('_p')[1]) || 1;
              return { panels: ['setup','inplay','progression'].map(x => x + suffix), text: Array.from({length:perPage}, (_,i) => saved.text?.[String((n-1)*perPage+i)] ?? ''), difficulty: saved.difficulty?.[index] || 2 };
            });
          }
          if (!records.length || records.length > 20) throw Error('A session can contain up to 20 pages.');
          records.forEach(record=>{
            if(!record || !Array.isArray(record.panels) || record.panels.length!==3 || !Array.isArray(record.text))throw Error('Invalid saved page.');
            record.panels.forEach(name=>{const scene=saved.scene[name];if(!scene || !Array.isArray(scene.items) || !D.pitches[scene.pitch])throw Error('Invalid saved diagram panel.');});
          });
          // Remove extra DOM and references without invoking confirmation dialogs.
          pages().slice(1).forEach(page => {
            panelNames(page).forEach(name => { PANELS.splice(PANELS.indexOf(name),1); delete D.scene[name]; delete svgs[name]; document.querySelector(`#jb-panel option[value="${name}"]`)?.remove(); });
            page.remove();
          });
          S.panel = PANELS[0]; S.sel = null; S.undo = [];
          for (let i=1; i<records.length; i++) document.getElementById('jf-addpage').click();
          pages().forEach((page,index) => {
            const record = records[index];
            panelNames(page).forEach((name,i) => {
              const scene = saved.scene[record.panels[i]];
              if (!scene || !Array.isArray(scene.items) || !D.pitches[scene.pitch]) throw Error('Invalid saved diagram panel.');
              D.scene[name] = JSON.parse(JSON.stringify(scene));
            });
            fields(page).forEach((el,i) => { if (typeof record.text[i] === 'string') el.innerHTML = record.text[i]; });
            page.querySelector('.jf-diff-toggle')?.__jfSetLevel?.(record.difficulty);
          });
          const title = document.querySelector('[aria-label="Session name"]');
          if (title && saved.title) title.value = saved.title;
          document.documentElement.dataset.plannerArtwork = saved.artwork === 'illustrated' ? 'illustrated' : 'classic';
          document.documentElement.dataset.realisticPlayerDisplay = saved.playerDisplay === 'number' ? 'number' : 'figure';
          setPlayerDisplay(saved.playerDisplay);
          S.panel = PANELS[0]; S.sel = null; document.getElementById('jb-panel').value = S.panel;
          api.paint(); window.__jfFitText?.(); fitTitles(); window.dispatchEvent(new Event('jf-document-restored'));
        } finally { restoring = false; }
      }
      const toggle=document.createElement('button');toggle.id='jf-tools-toggle';toggle.textContent='Tools & save';toggle.setAttribute('aria-controls','jb');toggle.setAttribute('aria-expanded','false');
      toggle.onclick=()=>{const open=document.body.classList.toggle('jf-tools-open');toggle.setAttribute('aria-expanded',String(open));};document.body.append(toggle);
      playerControls = document.createElement('section');
      playerControls.id = 'jf-player-controls';
      playerControls.setAttribute('aria-label', 'Player controls');
      playerControls.innerHTML = '<h5>Player display</h5><p data-player-display-note>Classic uses numbered circles.</p><div class="jf-player-choice"><button type="button" data-player-display="figure" aria-pressed="true">Figures</button><button type="button" data-player-display="number" aria-pressed="false">Numbered circles</button></div><h5>Selected player</h5><p data-player-hint>Select a player on a diagram to edit it</p><label>Number<input data-player-control data-player-number inputmode="numeric" maxlength="3" aria-label="Player number"></label><label>Size<input data-player-control data-player-size type="range" min="0.4" max="1.8" step="0.1" aria-label="Player size"></label><label>Rotation<input data-player-control data-player-rotation type="range" min="-180" max="180" step="15" aria-label="Player rotation"></label><div class="jf-player-nudges"><button type="button" data-player-control data-player-rotate="-45">↶ 45°</button><button type="button" data-player-control data-player-rotate="0">Forward</button><button type="button" data-player-control data-player-rotate="45">45° ↷</button></div>';
      document.getElementById('jb').append(playerControls);
      playerControls.querySelectorAll('[data-player-display]').forEach(button => button.addEventListener('click', () => setPlayerDisplay(button.dataset.playerDisplay)));
      playerControls.querySelector('[data-player-number]').addEventListener('change', event => changePlayer(player => { player.n = event.target.value.replace(/[^0-9]/g, '').slice(0, 3); }));
      playerControls.querySelector('[data-player-size]').addEventListener('change', event => changePlayer(player => { player.s = Number(event.target.value); }));
      playerControls.querySelector('[data-player-rotation]').addEventListener('change', event => changePlayer(player => { player.r = Number(event.target.value); }));
      playerControls.querySelectorAll('[data-player-rotate]').forEach(button => button.addEventListener('click', () => changePlayer(player => { const turn = Number(button.dataset.playerRotate); player.r = turn === 0 ? 0 : Math.max(-180, Math.min(180, (Number(player.r) || 0) + turn)); })));
      function fit(){const width=innerWidth-(innerWidth>900?244:20);document.documentElement.style.setProperty('--jf-page-scale',String(Math.min(1.15,width/(210*96/25.4))));}
      window.addEventListener('resize',fit);fit();
      document.addEventListener('click',e=>{if(e.target.closest('#jb-pal .pi')&&innerWidth<=900){document.body.classList.remove('jf-tools-open');toggle.setAttribute('aria-expanded','false');}});
      function restoreCloud(saved){
        let draft;try{draft=JSON.parse(localStorage.getItem(key)||'null');}catch{}
        if(draft && draft.template===saved.template){try{restore(draft);ready=true;return true;}catch{}}
        restore(saved);ready=true;return false;
      }
      const result = { snapshot, restore, restoreCloud, persist, schedule, get restoring(){return restoring;} };
      window.JonerArtwork?.install(api.paint,schedule);
      window.__jfDocument = result;
      api.observe(schedule);
      api.observe(() => { rotatePlayers(); syncPlayerControls(); });
      setPlayerDisplay(document.documentElement.dataset.realisticPlayerDisplay || document.documentElement.dataset.playerDisplay || existingDisplay());
      document.addEventListener('input', schedule);
      document.addEventListener('change', event => {
        if (!event.target.matches('select[aria-label="Artwork"]')) return;
        setPlayerDisplay(document.documentElement.dataset.realisticPlayerDisplay || 'figure');
        schedule();
      });
      document.addEventListener('click', e => { if (e.target.closest('.jf-diff-toggle')) schedule(); });
      document.addEventListener('pointerup', schedule);
      document.addEventListener('pointercancel', schedule);
      window.addEventListener('pagehide', persist);
      document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
      const download = document.createElement('button');
      download.textContent = 'Download session backup'; download.id = 'jf-download-document';
      download.onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot(),null,2)],{type:'application/json'})); const a=document.createElement('a'); a.href=url; a.download='joner-session-backup.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); };
      status.after(download);
      window.addEventListener('load', () => {
        // A saved document must load before artwork events can autosave.
        ready = !params.get('plan');
        if (!params.get('plan')) {
          try { const raw=localStorage.getItem(key); if(raw) restore(JSON.parse(raw)); }
          catch { status.textContent='Could not restore the device draft. Your saved copy has been kept.'; ready=false; return; }
          persist();
          window.JonerDraftStash?.documentReady?.(key);
        }
      });
      return result;
    }
  };
})();
