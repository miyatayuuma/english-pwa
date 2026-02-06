export function toggleLevelSelection(currentLevels, level, allLevels){
  let nextLevels=currentLevels instanceof Set ? new Set(currentLevels) : new Set();
  if(nextLevels.has(level)){
    if(nextLevels.size===1){
      nextLevels=new Set(allLevels);
    }else{
      nextLevels.delete(level);
    }
  }else{
    nextLevels.add(level);
  }
  if(!nextLevels.size){
    nextLevels=new Set(allLevels);
  }
  return nextLevels;
}

export function createFilterController({
  el,
  levelChoices,
  qsa,
  storage,
  deps,
}){
  const { SECTION_SELECTION, ORDER_SELECTION }=storage;
  const {
    loadSearchQuery,
    saveSearchQuery,
    currentSearchQuery,
    loadOrderSelection,
    saveOrderSelection,
    saveSectionSelection,
    getActiveLevelArray,
    getLevelFilterSet,
    setLevelFilterSet,
    rebuildAndRender,
    updateHeaderStats,
    finalizeActiveSession,
    updateSectionOptions,
  }=deps;


  function updateLevelFilterButtons(){
    if(!el?.levelFilter) return;
    const active=new Set(getActiveLevelArray());
    qsa('button[data-level]', el.levelFilter).forEach(btn=>{
      const level=Number(btn.dataset.level||'0');
      const on=active.has(level);
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on?'true':'false');
    });
  }

  function initLevelFilterUI(){
    if(!el?.levelFilter) return;
    el.levelFilter.innerHTML='';
    const label=document.createElement('span');
    label.className='level-filter-label';
    label.textContent='Lv';
    el.levelFilter.appendChild(label);
    const btnWrap=document.createElement('div');
    btnWrap.className='level-filter-buttons';
    el.levelFilter.appendChild(btnWrap);
    const activeLevels=new Set(getActiveLevelArray());
    for(const level of levelChoices){
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='level-chip';
      btn.dataset.level=String(level);
      btn.textContent=String(level);
      if(activeLevels.has(level)){
        btn.classList.add('active');
        btn.setAttribute('aria-pressed','true');
      }else{
        btn.setAttribute('aria-pressed','false');
      }
      btn.addEventListener('click',()=>{
        const nextLevels=toggleLevelSelection(getLevelFilterSet(), level, levelChoices);
        setLevelFilterSet(nextLevels);
        updateLevelFilterButtons();
        rebuildAndRender(true);
      });
      btnWrap.appendChild(btn);
    }
    updateLevelFilterButtons();
  }

  function initSectionPicker(){
    updateSectionOptions({preferSaved:true});
    const handleSectionChange=(value)=>{
      if(el?.secSel && el.secSel.value!==value) el.secSel.value=value;
      if(el?.studySecSel && el.studySecSel.value!==value) el.studySecSel.value=value;
      saveSectionSelection(SECTION_SELECTION, value);
      rebuildAndRender(true);
    };
    if(el?.secSel){
      el.secSel.onchange=()=>{ handleSectionChange(el.secSel.value); };
    }
    if(el?.studySecSel){
      el.studySecSel.onchange=()=>{ handleSectionChange(el.studySecSel.value); };
    }
    if(el?.orderSel){
      const ordSaved=loadOrderSelection(ORDER_SELECTION, 'asc')||'asc';
      el.orderSel.value=['asc','rnd','srs'].includes(ordSaved) ? ordSaved : 'asc';
      el.orderSel.onchange=()=>{
        saveOrderSelection(ORDER_SELECTION, el.orderSel.value);
        rebuildAndRender(true);
      };
    }
    if(el?.search){
      const saved=loadSearchQuery();
      if(saved){
        el.search.value=saved;
      }
      let lastAppliedSearch=currentSearchQuery();
      let searchTimer=null;
      const resetSessionForSearch=()=>finalizeActiveSession();
      const applySearchChange=(fromChange=false)=>{
        if(searchTimer){
          clearTimeout(searchTimer);
          searchTimer=null;
        }
        const trimmed=currentSearchQuery();
        if(fromChange && el.search.value!==trimmed){
          el.search.value=trimmed;
        }
        saveSearchQuery(trimmed);
        if(trimmed===lastAppliedSearch){
          return;
        }
        lastAppliedSearch=trimmed;
        updateHeaderStats();
        const resetPromise=resetSessionForSearch();
        Promise.resolve(resetPromise)
          .catch(()=>{})
          .finally(()=>{ rebuildAndRender(true,{autoStart:false}); });
      };
      const scheduleSearchChange=()=>{
        if(searchTimer){
          clearTimeout(searchTimer);
        }
        searchTimer=setTimeout(()=>{
          applySearchChange(false);
        }, 220);
      };
      el.search.addEventListener('input', ()=>{
        saveSearchQuery(el.search.value.trim());
        scheduleSearchChange();
      });
      el.search.addEventListener('change', ()=>{
        applySearchChange(true);
      });
    }
    initLevelFilterUI();
  }

  return {
    initSectionPicker,
    initLevelFilterUI,
    updateLevelFilterButtons,
  };
}
