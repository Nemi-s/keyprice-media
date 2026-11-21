(function () {
  "use strict";

  var CLIPS = [
    { src: "clip1.mp4", poster: "clip1-poster.jpg" },
    { src: "clip2.mp4", poster: "clip2-poster.jpg" },
    { src: "clip3.mp4", poster: "clip3-poster.jpg" },
    { src: "clip4.mp4", poster: "clip4-poster.jpg" }
  ];
  var COPY = [
    { a: "Buying a new car?", b: "Beat the showroom price." },
    { a: "Join a batch.", b: "Buy together." },
    { a: "We negotiate.", b: "You save." },
    { a: "Free for buyers.", b: "Keep 100% of the discount." }
  ];
  var END_PORTION = 0.18;
  var FADE = 0.16;
  var WA = "919769700512";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) document.documentElement.classList.add("reduced");

  var layersEl = document.getElementById("layers");
  var copyEl = document.getElementById("copy");
  var lineA = document.getElementById("lineA");
  var lineB = document.getElementById("lineB");
  var endcard = document.getElementById("endcard");
  var hint = document.getElementById("hint");
  var scrolly = document.getElementById("scrolly");
  var form = document.getElementById("joinForm");
  var joinBtn = document.getElementById("joinBtn");

  var layers = CLIPS.map(function (clip, i) {
    var layer = document.createElement("div");
    layer.className = "layer";
    layer.dataset.index = String(i);

    var frame = document.createElement("div");
    frame.className = "frame";

    var poster = document.createElement("img");
    poster.className = "poster";
    poster.src = clip.poster;
    poster.alt = "";
    poster.draggable = false;

    var video = document.createElement("video");
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("muted", "");
    video.preload = i === 0 ? "auto" : "metadata";
    video.loop = false;
    video.controls = false;
    video.disablePictureInPicture = true;
    video.setAttribute("disablepictureinpicture", "");
    video.poster = clip.poster;
    video.setAttribute("data-src", clip.src);
    if (i === 0) video.src = clip.src;

    frame.appendChild(poster);
    frame.appendChild(video);
    layer.appendChild(frame);
    layersEl.appendChild(layer);
    return { layer: layer, frame: frame, video: video, poster: poster, src: clip.src, loaded: i === 0 };
  });

  var copyIndex = -1;
  var unlocked = false;
  var targetProgress = 0;
  var renderProgress = 0;
  var lastSeek = [0, 0, 0, 0];
  var ticking = false;

  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  function loadClip(i) {
    var item = layers[i];
    if (!item || item.loaded) return;
    item.video.src = item.src;
    item.video.preload = "auto";
    try { item.video.load(); } catch (e) {}
    item.loaded = true;
  }

  function preloadAround(index) {
    loadClip(index);
    if (index + 1 < layers.length) loadClip(index + 1);
    if (index + 2 < layers.length) loadClip(index + 2);
  }

  function unlockVideos() {
    if (unlocked) return;
    unlocked = true;
    layers.forEach(function (item, i) {
      if (i > 0) loadClip(i);
      var v = item.video;
      v.muted = true;
      var play = v.play();
      if (play && typeof play.then === "function") {
        play.then(function () { v.pause(); }).catch(function () {});
      }
    });
  }

  function sectionProgress() {
    var rect = scrolly.getBoundingClientRect();
    var travel = scrolly.offsetHeight - window.innerHeight;
    if (travel <= 0) return 0;
    return clamp(-rect.top / travel, 0, 1);
  }

  function sceneState(p) {
    var videoSpan = 1 - END_PORTION;
    if (p >= videoSpan) {
      return { index: 3, local: 1, next: 3, fade: 0, end: (p - videoSpan) / END_PORTION };
    }
    var t = p / videoSpan;
    var raw = t * 4;
    var index = Math.min(3, Math.floor(raw));
    var local = raw - index;
    var next = Math.min(3, index + 1);
    var fade = 0;
    if (index < 3 && local > 1 - FADE) fade = (local - (1 - FADE)) / FADE;
    return { index: index, local: local, next: next, fade: fade, end: 0 };
  }

  function textOpacity(local, isFirst, isLastVideo, fade) {
    if (isFirst && local < 0.12) return 1;
    if (local < 0.08) return local / 0.08;
    if (fade > 0) return 1 - fade;
    if (isLastVideo && local > 0.86) return (1 - local) / 0.14;
    return 1;
  }

  function setCopy(index) {
    if (index === copyIndex) return;
    copyIndex = index;
    var c = COPY[index];
    lineA.textContent = c.a;
    lineB.textContent = c.b;
  }

  function seekVideo(item, t) {
    var v = item.video;
    if (!v || v.readyState < 1 || !isFinite(v.duration) || v.duration <= 0) return;
    var time = clamp(t, 0, Math.max(0, v.duration - 0.05));
    if (Math.abs(time - lastSeek[layers.indexOf(item)]) < 0.04) return;
    lastSeek[layers.indexOf(item)] = time;
    try { v.currentTime = time; } catch (e) {}
  }

  function render(p) {
    var state = sceneState(p);
    preloadAround(state.index);

    layers.forEach(function (item, i) {
      var opacity = 0;
      var localForZoom = 0;
      if (i === state.index) {
        opacity = 1 - state.fade;
        localForZoom = state.local;
      } else if (i === state.next && state.fade > 0) {
        opacity = state.fade;
        localForZoom = 0;
      }
      if (state.end > 0 && i === 3) {
        opacity = 1;
        localForZoom = 1;
      }
      item.layer.style.opacity = String(opacity);
      var zoom = 1 + localForZoom * 0.08;
      item.frame.style.transform = "scale(" + zoom.toFixed(4) + ")";

      if (opacity > 0.02) {
        var dur = item.video.duration;
        if (isFinite(dur) && dur > 0) {
          var local = (i === state.index) ? state.local : (i === 3 && state.end > 0 ? 1 : 0);
          seekVideo(item, local * dur);
        }
      }
    });

    setCopy(state.index);
    var tOpacity = state.end > 0 ? 0 : textOpacity(state.local, state.index === 0, state.index === 3, state.fade);
    copyEl.style.opacity = String(clamp(tOpacity, 0, 1));
    copyEl.style.transform = "translateY(" + ((1 - tOpacity) * 12).toFixed(1) + "px)";

    var endOn = state.end > 0.02;
    endcard.classList.toggle("is-on", endOn);
    endcard.setAttribute("aria-hidden", endOn ? "false" : "true");
    endcard.style.opacity = String(clamp(state.end / 0.35, 0, 1));

    if (hint) hint.style.opacity = String(p < 0.06 ? 1 : clamp(1 - (p - 0.06) / 0.08, 0, 1));
  }

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

  function onScroll() {
    targetProgress = sectionProgress();
    if (!ticking && !reduced) {
      ticking = true;
      requestAnimationFrame(tick);
    } else if (reduced) {
      render(targetProgress);
    }
  }

  function tick() {
    renderProgress += (targetProgress - renderProgress) * 0.22;
    if (Math.abs(targetProgress - renderProgress) < 0.0008) renderProgress = targetProgress;
    render(renderProgress);
    if (Math.abs(targetProgress - renderProgress) > 0.0008) {
      requestAnimationFrame(tick);
    } else {
      ticking = false;
    }
  }

  if (reduced) {
    layers[0].layer.style.opacity = "1";
    setCopy(0);
    copyEl.style.opacity = "1";
    if (hint) hint.style.display = "none";
    var cta = document.createElement("a");
    cta.className = "btn btn-light btn-lg reduced-cta";
    cta.href = "#join";
    cta.textContent = "Order now";
    cta.style.cssText = "position:absolute;left:50%;bottom:8vh;transform:translateX(-50%);z-index:5;";
    document.getElementById("stage").appendChild(cta);
  } else {
    render(0);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    var kick = function () { unlockVideos(); onScroll(); };
    window.addEventListener("pointerdown", kick, { once: false, passive: true });
    window.addEventListener("touchstart", kick, { once: false, passive: true });
    window.addEventListener("wheel", kick, { once: false, passive: true });
    window.addEventListener("keydown", kick);
    // Best-effort unlock on load for desktop autoplay policies.
    layers[0].video.addEventListener("loadedmetadata", function () {
      try { layers[0].video.currentTime = 0.01; } catch (e) {}
    });
    requestAnimationFrame(onScroll);
  }

  readForm();
})();
