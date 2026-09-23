(function () {
  var el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'pointer-events:none',
    'z-index:49',
    'background-image:' + [
      // Spotlight from top-center
      'radial-gradient(ellipse 90% 55% at 50% -5%,rgba(255,255,255,0.07) 0%,transparent 65%)',
      // Blue accent glow top-right
      'radial-gradient(ellipse 45% 35% at 88% 4%,rgba(74,184,212,0.05) 0%,transparent 55%)',
      // Green glow bottom-left
      'radial-gradient(ellipse 50% 30% at 8% 92%,rgba(46,204,113,0.04) 0%,transparent 55%)',
      // Grid lines
      'repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,0.04) 40px)',
      'repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,0.04) 40px)'
    ].join(',')
  ].join(';');
  document.body.appendChild(el);
})();
