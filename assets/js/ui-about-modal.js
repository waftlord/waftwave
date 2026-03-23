// About / Info modal wiring

'use strict';

(function(){
  const openBtn = document.getElementById('aboutBtn');
  const modal   = document.getElementById('aboutModal');

  function openModal(){
    if (!modal) return;
    modal.classList.remove('hidden');
  }

  function closeModal(){
    if (!modal) return;
    modal.classList.add('hidden');
  }

  if (openBtn) openBtn.addEventListener('click', openModal);

  if (modal){
    modal.addEventListener('click', (e)=>{
      const t = e.target;
      if (t && t.matches && t.matches('[data-close-modal]')) closeModal();
    });
  }

  window.addEventListener('keydown', (e)=>{
    if (!modal) return;
    if (modal.classList.contains('hidden')) return;
    if (e.key === 'Escape') closeModal();
  });
})();
