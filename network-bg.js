(function () {
  var el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    'z-index:9999',
    'background-image:' +
      'repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.04) 40px),' +
      'repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.04) 40px)'
  ].join(';');
  document.body.appendChild(el);
})();
