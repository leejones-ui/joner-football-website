(function(){
  let catalogue=null,utils=null,players=null,refresh=()=>{};
  Promise.all([
    fetch('/planner-art/equipment.json').then(r=>{if(!r.ok)throw Error('Artwork unavailable');return r.json();}),
    import('/planner-art/asset-utils.js'),import('/planner-art/player-art.js')
  ]).then(([data,helpers,figures])=>{catalogue=data;utils=helpers;players=figures;refresh();}).catch(()=>{});
  const escape=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const isPlayer=id=>/^pl(?:Ready|Pass)_/.test(id||'');
  function circle(n,c){return `<circle cx="0" cy="-20" r="20" fill="${/^#[0-9a-f]{6}$/i.test(c)?c:'#c42318'}" stroke="white" stroke-width="2"/><text x="0" y="-19" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="Arial,sans-serif" font-size="20" font-weight="bold">${escape(String(n||1).slice(0,3))}</text>`;}
  function player(id,c,n,key,mode){
    if(mode!=='illustrated'||!players)return circle(n,c);
    const pose=id.startsWith('plPass')?'pass':'receive',skin=id.split('_')[1];
    return `<svg x="-30" y="-76" width="60" height="88" viewBox="0 0 64 88">${players.playerSvgContent({pose,skin,color:c||'#c42318',artwork:'illustrated',filterId:key})}</svg>`;
  }
  function asset(id){
    if(!catalogue||!utils||!id)return null;
    const mapping=catalogue.onTheGo[id];if(!mapping)return null;
    const item=catalogue.equipment[mapping.kind];
    return {href:utils.artUrl(item.file),width:mapping.width,height:mapping.height,filter:utils.equipmentFilter(mapping.color,item.baseHue)};
  }
  function image(a,x,y,width,height){return `<image href="${escape(a.href)}" x="${x}" y="${y}" width="${width}" height="${height}"${a.filter?` style="filter:${a.filter}"`:''} preserveAspectRatio="xMidYMid meet"/>`;}
  window.JonerArtwork={
    svg(it){
      if(it.k!=='eq')return '';
      const mode=document.documentElement.dataset.plannerArtwork||'classic',s=it.s??1;
      if(isPlayer(it.id)){
        const effective=mode==='illustrated'&&document.documentElement.dataset.playerDisplay!=='number'?'illustrated':'classic';
        const key=`kit-${it.id}-${String(it.c).replace('#','')}-${String(it.x).replace('.','_')}-${String(it.y).replace('.','_')}`;
        return `<g transform="translate(${it.x},${it.y}) scale(${it.f?-s:s},${s})">${player(it.id,it.c,it.n,key,effective)}</g>`;
      }
      if(/^flatdisc/.test(it.id) && /^#[0-9a-f]{6}$/i.test(it.c||''))return `<g transform="translate(${it.x},${it.y}) scale(${s})"><ellipse rx="18" ry="9" fill="${it.c}" stroke="#111" stroke-width="1"/></g>`;
      if(mode!=='illustrated')return '';
      const a=asset(it.id);if(!a)return '';
      return `<g transform="translate(${it.x},${it.y}) scale(${it.f?-s:s},${s})">${image(a,-a.width/2,-a.height+10,a.width,a.height)}</g>`;
    },
    install(paint,persist){
      const label=document.createElement('label');label.textContent='Artwork';
      const select=document.createElement('select');select.setAttribute('aria-label','Artwork');select.innerHTML='<option value="classic">Classic · numbered circles</option><option value="illustrated">Realistic players & equipment</option>';label.append(select);
      document.getElementById('jb').querySelector('h3').after(label);
      const originals=new Map([...document.querySelectorAll('#jb-pal .pi')].map(el=>[el,el.querySelector('svg').innerHTML]));
      function sync(){
        select.value=document.documentElement.dataset.plannerArtwork||'classic';let number=0;
        originals.forEach((original,el)=>{const id=el.dataset.jfA,a=asset(id);el.querySelector('svg').innerHTML=isPlayer(id)?player(id,'#c42318',++number,'palette-'+id,select.value):select.value==='illustrated'&&a?image(a,-42,-78,84,92):original;});
      }
      refresh=()=>{sync();paint();};
      select.onchange=()=>{document.documentElement.dataset.plannerArtwork=select.value;sync();paint();persist();};
      window.addEventListener('jf-document-restored',sync);sync();
    }
  };
})();
