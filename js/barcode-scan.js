// Camera barcode reading at the camera's full resolution. html5-qrcode shrinks the
// picture to the size of its on-screen box (about 330 px wide on an iPhone) before
// decoding, which leaves small barcodes under 1 px per bar: unreadable however sharp
// the camera is. This feeds the box's real camera pixels to BarcodeDetector instead
// (built in on Android, the zxing-cpp polyfill on iPhone).
(function () {
  var FORMATS = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'qr_code'];
  var MAX_WIDTH = 1600; // enough for thin bars; bigger only slows each try down
  var PAUSE_MS = 40;    // between tries, so the phone stays responsive

  function supportedFormats() {
    if (!window.BarcodeDetector.getSupportedFormats) return Promise.resolve(FORMATS);
    return window.BarcodeDetector.getSupportedFormats().then(function (have) {
      return FORMATS.filter(function (f) { return have.indexOf(f) !== -1; });
    });
  }

  // The camera pixels under the on-screen box. The video is drawn with
  // object-fit: cover, so part of the picture is cut off on two sides.
  function cropOf(video, box) {
    var vw = video.videoWidth, vh = video.videoHeight, cw = video.clientWidth, ch = video.clientHeight;
    var scale = Math.max(cw / vw, ch / vh);
    var x = (vw - cw / scale) / 2 + (cw - box.width) / 2 / scale;
    var y = (vh - ch / scale) / 2 + (ch - box.height) / 2 / scale;
    return { x: x, y: y, width: box.width / scale, height: box.height / scale };
  }

  // container: the element the video goes in.
  // opts.box(w, h) → { width, height }: the centred on-screen box, in CSS pixels.
  // opts.onRead(text), opts.onReady(), opts.onCameraError(err), and
  // opts.onBroken(): the decoder itself doesn't work, use the old scanner.
  // Returns stop().
  function start(container, opts) {
    var stopped = false, stream = null, failures = 0, worked = false;
    var video = document.createElement('video');
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    video.muted = true; video.autoplay = true;
    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d', { willReadFrequently: true });

    function stop() {
      stopped = true;
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
      video.srcObject = null;
      if (video.parentNode) video.parentNode.removeChild(video);
    }

    function loop(detector) {
      if (stopped) return;
      function again() { setTimeout(function () { loop(detector); }, PAUSE_MS); }
      if (!video.videoWidth || video.readyState < 2) return again();
      var c = cropOf(video, opts.box(video.clientWidth, video.clientHeight));
      var shrink = Math.min(1, MAX_WIDTH / c.width);
      canvas.width = Math.round(c.width * shrink);
      canvas.height = Math.round(c.height * shrink);
      ctx.drawImage(video, c.x, c.y, c.width, c.height, 0, 0, canvas.width, canvas.height);
      detector.detect(canvas).then(function (found) {
        worked = true;
        if (!stopped && found.length) opts.onRead(found[0].rawValue);
        again();
      }).catch(function () {
        if (!worked && ++failures >= 5) { stop(); opts.onBroken(); return; }
        again();
      });
    }

    navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }
    }).then(function (s) {
      if (stopped) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
      stream = s;
      video.srcObject = s;
      container.appendChild(video);
      // Not every phone offers this; the camera's own default is the fallback
      try {
        var track = s.getVideoTracks()[0];
        var can = track.getCapabilities ? track.getCapabilities() : {};
        if (can.focusMode && can.focusMode.indexOf('continuous') !== -1) {
          track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(function () {});
        }
      } catch (e) {}
      return video.play().catch(function () {}).then(supportedFormats).then(function (formats) {
        if (stopped) return;
        opts.onReady();
        loop(new window.BarcodeDetector({ formats: formats }));
      });
    }).catch(function (e) {
      if (!stopped) { stop(); opts.onCameraError(e); }
    });
    return stop;
  }

  window.FastScan = {
    supported: function () { return !!(window.BarcodeDetector && navigator.mediaDevices && navigator.mediaDevices.getUserMedia); },
    start: start
  };
})();
