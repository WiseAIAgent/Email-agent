(function () {
  var canvas = document.createElement('canvas');
  canvas.id = 'network-bg';
  canvas.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:100%',
    'height:100%',
    'pointer-events:none',
    'z-index:9999',
    'mix-blend-mode:screen'
  ].join(';');
  document.body.appendChild(canvas);

  var ctx = canvas.getContext('2d');
  var nodes = [], W, H, raf;

  var CFG = {
    count:    55,
    maxDist:  145,
    speed:    0.28,
    nodeR:    1.6,
    nodeA:    0.28,
    lineAMax: 0.12,
    color:    '255,255,255'
  };

  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function init() {
    nodes = [];
    for (var i = 0; i < CFG.count; i++) {
      nodes.push({
        x:  Math.random() * W,
        y:  Math.random() * H,
        vx: (Math.random() - 0.5) * CFG.speed,
        vy: (Math.random() - 0.5) * CFG.speed
      });
    }
  }

  function tick() {
    // Black fill is transparent under screen blend-mode
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
      ctx.beginPath();
      ctx.arc(n.x, n.y, CFG.nodeR, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(' + CFG.color + ',' + CFG.nodeA + ')';
      ctx.fill();
    }

    for (var i = 0; i < nodes.length - 1; i++) {
      for (var j = i + 1; j < nodes.length; j++) {
        var dx = nodes[i].x - nodes[j].x;
        var dy = nodes[i].y - nodes[j].y;
        var d  = Math.sqrt(dx * dx + dy * dy);
        if (d < CFG.maxDist) {
          ctx.beginPath();
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.strokeStyle = 'rgba(' + CFG.color + ',' + (CFG.lineAMax * (1 - d / CFG.maxDist)) + ')';
          ctx.lineWidth = 0.65;
          ctx.stroke();
        }
      }
    }

    raf = requestAnimationFrame(tick);
  }

  resize();
  init();
  tick();

  window.addEventListener('resize', function () {
    cancelAnimationFrame(raf);
    resize();
    init();
    tick();
  });
})();
