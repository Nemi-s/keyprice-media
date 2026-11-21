(function () {
  "use strict";

  var CLIPS = [
    { id: 1, count: 71, dir: "frames/clip1", poster: "clip1-poster.jpg" },
    { id: 2, count: 71, dir: "frames/clip2", poster: "clip2-poster.jpg" },
    { id: 3, count: 71, dir: "frames/clip3", poster: "clip3-poster.jpg" },
    { id: 4, count: 63, dir: "frames/clip4", poster: "clip4-poster.jpg" }
  ];
  var COPY = [
    { a: "Buying a new car?", b: "Beat the showroom price." },
    { a: "Join a batch.", b: "Buy together." },
    { a: "We negotiate.", b: "You save." },
    { a: "Free for buyers.", b: "Keep 100% of the discount." }
  ];

  // Long film track: 4 × 250vh scenes + 180vh end card.
  var SCENE_VH = 250;
  var END_VH = 180;
  var FILM_VH = SCENE_VH * 4;
  var TRACK_VH = FILM_VH + END_VH;
  // Scene windows in film time (0–1). Each lasts 0.36 with a 0.18 overlap,
  // so crossfades last about 180vh — long and cinematic.
  var STARTS = [0, 0.18, 0.36, 0.54];
  var ENDS = [0.36, 0.54, 0.72, 1];
  var FADE = 0.18;
  var LERP_TAU = 0.16;
  var INERTIA_TAU = 0.14;
  var CACHE_MAX = 90;
  var WINDOW = 10;
  var WA = "919769700512";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) document.documentElement.classList.add("reduced");

  var layersEl = document.getElementById("layers");
  var stage = document.getElementById("stage");
  var scrolly = document.getElementById("scrolly");
  var endcard = document.getElementById("endcard");
  var hint = document.getElementById("hint");
  var form = document.getElementById("joinForm");
  var joinBtn = document.getElementById("joinBtn");
  var stacks = [
    document.getElementById("stack0"),
    document.getElementById("stack1")
  ];

  if (!reduced && scrolly) {
    scrolly.style.height = TRACK_VH + "vh";
  }

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }
  function smoothstep(t) {
    t = clamp(t, 0, 1);
    return t * t * (3 - 2 * t);
  }
  function frameUrl(clip, index1) {
    var n = String(index1);
    while (n.length < 3) n = "0" + n;
    return clip.dir + "/" + n + ".webp";
  }

  // --- frame cache (LRU, pinned window around the playhead) ---
  var cache = new Map();
  var inflight = new Map();
  var posters = [];

  function touch(key) {
    if (!cache.has(key)) return;
    var val = cache.get(key);
    cache.delete(key);
    cache.set(key, val);
  }

  function evict(pinned) {
    if (cache.size <= CACHE_MAX) return;
    var keys = Array.from(cache.keys());
    for (var i = 0; i < keys.length && cache.size > CACHE_MAX; i++) {
      if (pinned[keys[i]]) continue;
      cache.delete(keys[i]);
    }
  }

  function loadImage(url) {
    if (inflight.has(url)) return inflight.get(url);
    var p = new Promise(function (resolve, reject) {
      var img = new Image();
      img.decoding = "async";
      img.onload = function () { resolve(img); };
      img.onerror = function () { inflight.delete(url); reject(new Error(url)); };
      img.src = url;
    });
    inflight.set(url, p);
    return p;
  }

  function getFrame(clipIndex, index1) {
    var key = clipIndex + ":" + index1;
    var hit = cache.get(key);
    if (hit) {
      touch(key);
      return hit;
    }
    return null;
  }

  function requestFrame(clipIndex, index1) {
    var clip = CLIPS[clipIndex];
    if (!clip || index1 < 1 || index1 > clip.count) return;
    var key = clipIndex + ":" + index1;
    if (cache.has(key) || inflight.has(key)) return;
    var p = loadImage(frameUrl(clip, index1)).then(function (img) {
      cache.set(key, img);
      inflight.delete(key);
      return img;
    }).catch(function () { inflight.delete(key); });
    inflight.set(key, p);
  }

  function preloadWindow(clipIndex, frame1, radius) {
    var clip = CLIPS[clipIndex];
    if (!clip) return;
    var lo = Math.max(1, frame1 - radius);
    var hi = Math.min(clip.count, frame1 + radius);
    for (var i = lo; i <= hi; i++) requestFrame(clipIndex, i);
  }

  function pinAround(clipIndex, frame1) {
    var pinned = {};
    var clip = CLIPS[clipIndex];
    if (!clip) return pinned;
    var lo = Math.max(1, frame1 - WINDOW);
    var hi = Math.min(clip.count, frame1 + WINDOW);
    for (var i = lo; i <= hi; i++) pinned[clipIndex + ":" + i] = true;
    pinned[clipIndex + ":1"] = true;
    return pinned;
  }

  // --- canvases ---
  var layers = CLIPS.map(function (clip, i) {
    var canvas = document.createElement("canvas");
    canvas.className = "film";
    canvas.setAttribute("aria-hidden", "true");
    layersEl.appendChild(canvas);
    var ctx = canvas.getContext("2d", { alpha: false });
    return {
      clip: clip,
      canvas: canvas,
      ctx: ctx,
      lastDrawn: -1,
      visible: false
    };
  });

  posters = CLIPS.map(function () { return null; });
  CLIPS.forEach(function (clip, i) {
    loadImage(clip.poster).then(function (img) {
      posters[i] = img;
      layers[i].lastDrawn = -1;
    }).catch(function () {});
  });

  function sizeCanvases() {
    var rect = stage.getBoundingClientRect();
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round(rect.width * dpr));
    var h = Math.max(1, Math.round(rect.height * dpr));
    // Keep GPU buffers reasonable on huge desktops.
    var maxW = 1920 * dpr;
    if (w > maxW) {
      var s = maxW / w;
      w = Math.round(w * s);
      h = Math.round(h * s);
    }
    layers.forEach(function (item) {
      if (item.canvas.width !== w || item.canvas.height !== h) {
        item.canvas.width = w;
        item.canvas.height = h;
        item.lastDrawn = -1;
      }
    });
  }

  function drawCover(ctx, img, w, h) {
    var iw = img.naturalWidth || img.width;
    var ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    var scale = Math.max(w / iw, h / ih);
    var dw = iw * scale;
    var dh = ih * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }

  function drawLayer(item, local) {
    var clip = item.clip;
    var count = clip.count;
    var f = clamp(local, 0, 1) * (count - 1);
    var i0 = Math.floor(f);
    var i1 = Math.min(count - 1, i0 + 1);
    var frac = f - i0;
    var key = i0 + frac * 0.999;
    // Skip redundant paints, but always allow a first paint.
    if (item.lastDrawn >= 0 && Math.abs(key - item.lastDrawn) < 0.004) return;

    var img0 = getFrame(item.clip && CLIPS.indexOf(clip), i0 + 1);
    var img1 = i1 !== i0 ? getFrame(CLIPS.indexOf(clip), i1 + 1) : null;
    var ctx = item.ctx;
    var w = item.canvas.width;
    var h = item.canvas.height;
    var fallback = posters[CLIPS.indexOf(clip)];

    if (!img0 && !fallback) return;

    ctx.fillStyle = "#07080a";
    ctx.fillRect(0, 0, w, h);
    if (img0) {
      drawCover(ctx, img0, w, h);
      if (img1 && frac > 0.02) {
        ctx.save();
        ctx.globalAlpha = frac;
        drawCover(ctx, img1, w, h);
        ctx.restore();
      }
    } else {
      drawCover(ctx, fallback, w, h);
    }
    item.lastDrawn = key;
  }

  // --- scroll progress ---
  function sectionProgress() {
    var rect = scrolly.getBoundingClientRect();
    var travel = scrolly.offsetHeight - window.innerHeight;
    if (travel <= 0) return 0;
    return clamp(-rect.top / travel, 0, 1);
  }

  function sceneWeights(filmT) {
    var out = [];
    for (var i = 0; i < 4; i++) {
      var u0 = STARTS[i];
      var u1 = ENDS[i];
      var fadeIn = u0 <= 0 ? 1 : smoothstep((filmT - u0) / FADE);
      var fadeOut = smoothstep((u1 - filmT) / FADE);
      var weight = fadeIn * fadeOut;
      var local = clamp((filmT - u0) / (u1 - u0), 0, 1);
      out.push({ weight: weight, local: local });
    }
    return out;
  }

  function setStackText(stack, copy) {
    if (stack.dataset.key === copy.a + "|" + copy.b) return;
    stack.dataset.key = copy.a + "|" + copy.b;
    stack.querySelector(".line-a").textContent = copy.a;
    stack.querySelector(".line-b").textContent = copy.b;
  }

  function applyLine(el, amount, delay) {
    var t = smoothstep(clamp((amount - delay) / (1 - delay), 0, 1));
    el.style.opacity = String(t);
    el.style.transform = "translate3d(0," + ((1 - t) * 28).toFixed(2) + "px,0)";
  }

  function render(p) {
    var filmPortion = FILM_VH / TRACK_VH;
    var filmT, endT;
    if (p >= filmPortion) {
      filmT = 1;
      endT = (p - filmPortion) / (1 - filmPortion);
    } else {
      filmT = p / filmPortion;
      endT = 0;
    }

    var states = sceneWeights(filmT);
    if (endT > 0) {
      // Hold the last frame of clip 4 under the end card.
      states[3].local = 1;
      states[3].weight = Math.max(states[3].weight, 1);
    }

    var pinned = {};
    var i, st, item, opacity, outgoing, scale, blur, clipIndex, frame1;

    for (i = 0; i < 4; i++) {
      item = layers[i];
      st = states[i];
      opacity = st.weight;
      item.canvas.style.opacity = String(opacity);
      item.visible = opacity > 0.012;

      if (!item.visible) {
        item.canvas.style.filter = "none";
        item.canvas.style.transform = "scale(1)";
        item.canvas.style.zIndex = "0";
        continue;
      }

      // Outgoing scenes slightly zoom and soften; incoming settle.
      outgoing = 0;
      if (i < 3 && filmT > ENDS[i] - FADE && filmT < ENDS[i] + 0.001) {
        outgoing = smoothstep((filmT - (ENDS[i] - FADE)) / FADE);
      }
      if (endT > 0 && i === 3) outgoing = smoothstep(endT * 0.85);

      scale = 1 + outgoing * 0.045 + (1 - opacity) * 0.02;
      blur = outgoing * 10 + (1 - opacity) * 6;
      item.canvas.style.transform = "scale(" + scale.toFixed(4) + ")";
      item.canvas.style.filter = blur > 0.2 ? "blur(" + blur.toFixed(2) + "px)" : "none";
      item.canvas.style.zIndex = String(10 + i);

      drawLayer(item, st.local);

      clipIndex = i;
      frame1 = Math.round(st.local * (CLIPS[i].count - 1)) + 1;
      preloadWindow(i, frame1, WINDOW);
      Object.assign(pinned, pinAround(i, frame1));
      if (i < 3 && st.local > 0.55) {
        preloadWindow(i + 1, 1, 8);
        Object.assign(pinned, pinAround(i + 1, 1));
      }
    }
    evict(pinned);

    // Two copy stacks, staggered fade/slide, no pops.
    for (i = 0; i < 4; i++) {
      if (states[i].weight > 0.02) setStackText(stacks[i % 2], COPY[i]);
    }
    for (var s = 0; s < 2; s++) {
      var wA = states[s] ? states[s].weight : 0;
      var wB = states[s + 2] ? states[s + 2].weight : 0;
      var amt = Math.max(wA, wB);
      // Text holds in the solid part of a scene and leaves a beat before the midpoint of the film crossfade.
      amt = smoothstep((amt - 0.48) / 0.40);
      if (endT > 0) amt *= 1 - smoothstep(endT / 0.22);
      var lineA = stacks[s].querySelector(".line-a");
      var lineB = stacks[s].querySelector(".line-b");
      applyLine(lineA, amt, 0);
      applyLine(lineB, amt, 0.14);
      stacks[s].setAttribute("aria-hidden", amt < 0.08 ? "true" : "false");
    }

    var endOn = endT > 0.02;
    var endAmt = smoothstep(clamp(endT / 0.42, 0, 1));
    endcard.classList.toggle("is-on", endOn);
    endcard.setAttribute("aria-hidden", endOn ? "false" : "true");
    endcard.style.opacity = String(endAmt);
    endcard.style.transform = "translate3d(0," + ((1 - endAmt) * 16).toFixed(2) + "px,0)";

    if (hint) {
      var hAmt = p < 0.018 ? 1 : clamp(1 - (p - 0.018) / 0.03, 0, 1);
      hint.style.opacity = String(hAmt);
    }
  }

  // --- rAF lerp of scroll progress (time-based, frame-rate independent) ---
  var targetProgress = 0;
  var renderProgress = 0;
  var ticking = false;
  var lastTs = 0;

  function onScroll() {
    targetProgress = sectionProgress();
    if (reduced) {
      render(targetProgress);
      return;
    }
    if (!ticking) {
      ticking = true;
      lastTs = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function tick(now) {
    var dt = Math.min(0.05, (now - lastTs) / 1000);
    lastTs = now;
    var k = 1 - Math.exp(-dt / LERP_TAU);
    renderProgress += (targetProgress - renderProgress) * k;
    if (Math.abs(targetProgress - renderProgress) < 0.00025) {
      renderProgress = targetProgress;
    }
    render(renderProgress);
    if (Math.abs(targetProgress - renderProgress) > 0.00025) {
      requestAnimationFrame(tick);
    } else {
      ticking = false;
    }
  }

  // Desktop-only wheel inertia. Native scroll on touch / coarse pointers.
  function enableInertia() {
    var coarse = window.matchMedia("(pointer: coarse)").matches;
    var noHover = window.matchMedia("(hover: none)").matches;
    if (coarse || noHover || reduced) return;

    var armed = true;
    var target = window.scrollY || 0;
    var current = target;
    var running = false;
    var last = 0;
    var driving = false;

    function maxY() {
      return Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    }

    function onWheel(e) {
      if (!armed) return;
      if (e.ctrlKey) return;
      var el = e.target;
      if (el && el.closest && el.closest("input, select, textarea")) return;
      e.preventDefault();
      target = clamp(target + e.deltaY, 0, maxY());
      if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(step);
      }
    }

    function step(now) {
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var k = 1 - Math.exp(-dt / INERTIA_TAU);
      current += (target - current) * k;
      if (Math.abs(target - current) < 0.35) current = target;
      driving = true;
      window.scrollTo(0, current);
      driving = false;
      if (Math.abs(target - current) >= 0.35) requestAnimationFrame(step);
      else running = false;
    }

    window.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("scroll", function () {
      if (driving) return;
      target = current = window.scrollY || 0;
    }, { passive: true });
    window.addEventListener("touchstart", function () {
      armed = false;
    }, { passive: true, once: true });

    document.documentElement.style.scrollBehavior = "auto";
    // Keep in-page CTA jumps working without the CSS smooth-scroll fight.
    document.addEventListener("click", function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="#"]') : null;
      if (!a) return;
      var id = a.getAttribute("href").slice(1);
      if (!id) return;
      var dest = document.getElementById(id);
      if (!dest) return;
      e.preventDefault();
      var top = dest.getBoundingClientRect().top + window.scrollY - 96;
      if (id === "top") top = 0;
      target = clamp(top, 0, maxY());
      if (!running) {
        running = true;
        last = performance.now();
        requestAnimationFrame(step);
      }
    });
  }

  // --- form (unchanged behaviour) ---
  function readForm() {
    var name = (form.elements.name.value || "").trim();
    var city = (form.elements.city.value || "").trim();
    var model = (form.elements.model.value || "").trim();
    joinBtn.disabled = !(name && city && model);
    return { name: name, city: city, model: model };
  }

  form.addEventListener("input", readForm);
  form.addEventListener("change", readForm);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var d = readForm();
    if (!d.name || !d.city || !d.model) return;
    var msg =
      "Hi KeyPrice, I want to join a group.\n" +
      "Name: " + d.name + "\n" +
      "City: " + d.city + "\n" +
      "Model: " + d.model;
    window.open("https://wa.me/" + WA + "?text=" + encodeURIComponent(msg), "_blank", "noopener");
  });

  // --- boot ---
  sizeCanvases();
  window.addEventListener("resize", function () {
    sizeCanvases();
    onScroll();
  });

  if (reduced) {
    layers[0].canvas.style.opacity = "1";
    drawLayer(layers[0], 0);
    setStackText(stacks[0], COPY[0]);
    applyLine(stacks[0].querySelector(".line-a"), 1, 0);
    applyLine(stacks[0].querySelector(".line-b"), 1, 0);
    if (hint) hint.style.display = "none";
    var cta = document.createElement("a");
    cta.className = "btn btn-light btn-lg reduced-cta";
    cta.href = "#join";
    cta.textContent = "Order now";
    cta.style.cssText = "position:absolute;left:50%;bottom:8vh;transform:translateX(-50%);z-index:5;";
    stage.appendChild(cta);
    preloadWindow(0, 1, 2);
  } else {
    preloadWindow(0, 1, 14);
    preloadWindow(1, 1, 4);
    enableInertia();
    render(0);
    window.addEventListener("scroll", onScroll, { passive: true });
    requestAnimationFrame(function () {
      sizeCanvases();
      onScroll();
    });
  }

  fetch("frames/manifest.json")
    .then(function (r) { return r.json(); })
    .then(function (m) {
      if (!m || !m.clips) return;
      m.clips.forEach(function (c, i) {
        if (CLIPS[i] && c.count) CLIPS[i].count = c.count;
      });
    })
    .catch(function () {});

  readForm();
})();
