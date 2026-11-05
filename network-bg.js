(function () {
  var style = document.createElement('style');
  style.textContent = [
    '#wa-bg{position:fixed;inset:0;pointer-events:none;z-index:49;overflow:hidden}',
    '.wa-blob{position:absolute;border-radius:50%;filter:blur(80px);will-change:transform}',

    '.wa-blob-1{',
      'width:680px;height:680px;',
      'background:radial-gradient(circle,rgba(38,122,82,.30) 0%,transparent 70%);',
      'top:-260px;left:-160px;',
      'animation:wa-d1 16s ease-in-out infinite alternate;',
    '}',
    '.wa-blob-2{',
      'width:560px;height:560px;',
      'background:radial-gradient(circle,rgba(55,110,210,.22) 0%,transparent 70%);',
      'top:-200px;right:-180px;',
      'animation:wa-d2 20s ease-in-out infinite alternate;',
      'animation-delay:-8s;',
    '}',
    '.wa-blob-3{',
      'width:440px;height:440px;',
      'background:radial-gradient(circle,rgba(61,200,122,.14) 0%,transparent 70%);',
      'top:28vh;left:36%;',
      'animation:wa-d3 14s ease-in-out infinite alternate;',
      'animation-delay:-4s;',
    '}',

    '@keyframes wa-d1{from{transform:translate(0,0) scale(1)}to{transform:translate(140px,100px) scale(1.1)}}',
    '@keyframes wa-d2{from{transform:translate(0,0) scale(1)}to{transform:translate(-120px,130px) scale(1.09)}}',
    '@keyframes wa-d3{from{transform:translate(0,0) scale(1)}to{transform:translate(90px,-100px) scale(1.15)}}',

    '.wa-grid{',
      'position:absolute;inset:0;',
      'background-image:',
        'repeating-linear-gradient(0deg,transparent,transparent 39px,rgba(255,255,255,.025) 40px),',
        'repeating-linear-gradient(90deg,transparent,transparent 39px,rgba(255,255,255,.025) 40px);',
    '}',

    '@media(prefers-reduced-motion:reduce){.wa-blob{animation:none}}',
  ].join('');
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.id = 'wa-bg';

  for (var i = 1; i <= 3; i++) {
    var b = document.createElement('div');
    b.className = 'wa-blob wa-blob-' + i;
    wrap.appendChild(b);
  }

  var grid = document.createElement('div');
  grid.className = 'wa-grid';
  wrap.appendChild(grid);

  document.body.appendChild(wrap);
})();
