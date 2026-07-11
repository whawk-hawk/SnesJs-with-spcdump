
let c = el("output");
c.width = 512;
c.height = 480;
let ctx = c.getContext("2d");
let imgData = ctx.getImageData(0, 0, 512, 480);

let loopId = 0;
let loaded = false;
let paused = false;
let pausedInBg = false;

let romArr = new Uint8Array([]);
let romBaseName = "dump"; // 現在読み込み中のROMのファイル名(拡張子なし)
let romDumpCounter = 0;   // 同じROMを読み込んでいる間、Dump SPCのたびに増える連番

let snes = new Snes();

let audioHandler = new AudioHandler();

let logging = false;
let noPpu = false;

zip.workerScriptsPath = "lib/";
zip.useWebWorkers = false;

let controlsP1 = {
  z: 0, // B
  a: 1, // Y
  shift: 2, // select
  enter: 3, // start
  arrowup: 4, // up
  arrowdown: 5, // down
  arrowleft: 6, // left
  arrowright: 7, // right
  x: 8, // A
  s: 9, // X
  d: 10, // L
  c: 11 // R
}

el("rom").onchange = function(e) {
  // ユーザー操作(ファイル選択)の中でunlockすることでiOS Safari等の自動再生制限を解除する
  audioHandler.unlock();
  let freader = new FileReader();
  freader.onload = function() {
    let buf = freader.result;
    if(e.target.files[0].name.slice(-4) === ".zip") {
      // use zip.js to read the zip
      let blob = new Blob([buf]);
      zip.createReader(new zip.BlobReader(blob), function(reader) {
        reader.getEntries(function(entries) {
          if(entries.length) {
            let found = false;
            for(let i = 0; i < entries.length; i++) {
              let name = entries[i].filename;
              if(name.slice(-4) !== ".smc" && name.slice(-4) !== ".sfc") {
                continue;
              }
              found = true;
              log("Loaded \"" + name + "\" from zip");
              romBaseName = name.replace(/\.[^./\\]+$/, "");
              romDumpCounter = 0;
              entries[i].getData(new zip.BlobWriter(), function(blob) {
                let breader = new FileReader();
                breader.onload = function() {
                  let rbuf = breader.result;
                  romArr = new Uint8Array(rbuf);
                  loadRom(romArr);
                  reader.close(function() {});
                }
                breader.readAsArrayBuffer(blob);
              }, function(curr, total) {});
              break;
            }
            if(!found) {
              log("No .smc or .sfc file found in zip");
            }
          } else {
            log("Zip file was empty");
          }
        });
      }, function(err) {
        log("Failed to read zip: " + err);
      });
    } else {
      // load rom normally
      romBaseName = e.target.files[0].name.replace(/\.[^./\\]+$/, "");
      romDumpCounter = 0;
      romArr = new Uint8Array(buf);
      loadRom(romArr);
    }
  }
  freader.readAsArrayBuffer(e.target.files[0]);
}

el("pause").onclick = function() {
  if(paused && loaded) {
    loopId = requestAnimationFrame(update);
    audioHandler.start();
    paused = false;
    el("pause").textContent = "Pause";
  } else {
    cancelAnimationFrame(loopId);
    audioHandler.stop();
    paused = true;
    el("pause").textContent = "Continue";
  }
}

el("reset").onclick = function(e) {
  snes.reset(false);
}

el("hardreset").onclick = function(e) {
  snes.reset(true);
}

el("runframe").onclick = function(e) {
  if(loaded) {
    runFrame();
  }
}

function doDumpSpc() {
  if(loaded) {
    romDumpCounter++;
    let num = String(romDumpCounter).padStart(2, "0");
    downloadSpc(snes, romBaseName + "_" + num + ".spc");
  }
}

el("dumpspc").onclick = doDumpSpc;
el("fs-dumpspc-btn").onclick = doDumpSpc;

// 疑似フルスクリーン方式(PC/iPhone共通)
// iOS SafariはFullscreen APIに対応していないため、requestFullscreen()には頼らず、
// position:fixedのオーバーレイ(.fullscreen-modeクラス)で画面全体を覆う。
let fullscreenActive = false;

// window.visualViewportの実測高さを--vvhとしてCSS変数に反映し続ける。
// Safariのアドレスバー増減による揺れを避けるため、100vhではなくこちらを優先して使う。
function updateViewportHeightVar() {
  let h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty("--vvh", h + "px");
}
updateViewportHeightVar();
if(window.visualViewport) {
  window.visualViewport.addEventListener("resize", updateViewportHeightVar);
  window.visualViewport.addEventListener("scroll", updateViewportHeightVar);
}

function toggleFullscreenMode() {
  fullscreenActive = !fullscreenActive;
  let container = el("game-container");
  container.classList.toggle("fullscreen-mode", fullscreenActive);
  if(fullscreenActive) {
    updateViewportHeightVar();
  }
  el("fullscreen").textContent = fullscreenActive ? "全画面解除" : "全画面";
}

el("fullscreen").onclick = toggleFullscreenMode;
el("fs-close-btn").onclick = toggleFullscreenMode;

// 画面回転対応:縦画面で全画面に入ったあと横に回転すると、iOS Safariで
// タッチ領域がずれることがあるため、fullscreen-modeクラスを一旦外して
// 次フレームで付け直し、レイアウトを強制的に再構築する
function handleFullscreenOrientationChange() {
  updateViewportHeightVar();
  setTimeout(updateViewportHeightVar, 150);
  if(!fullscreenActive) {
    return;
  }
  let container = el("game-container");
  container.classList.remove("fullscreen-mode");
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      container.classList.add("fullscreen-mode");
    });
  });
}

window.addEventListener("orientationchange", handleFullscreenOrientationChange);

el("ishirom").onchange = function(e) {
  if(loaded) {
    // reload when switching from LoROM to HiROM
    loadRom(romArr);
  }
}

document.onvisibilitychange = function(e) {
  if(document.hidden) {
    pausedInBg = false;
    if(!paused && loaded) {
      el("pause").click();
      pausedInBg = true;
    }
  } else {
    if(pausedInBg && loaded) {
      el("pause").click();
      pausedInBg = false;
    }
  }
}

function loadRom(rom) {
  let hiRom = el("ishirom").checked;
  if(snes.loadRom(rom, hiRom)) {
    snes.reset(true);
    if(!loaded && !paused) {
      loopId = requestAnimationFrame(update);
      audioHandler.start();
    }
    loaded = true;
  }
}

function runFrame() {

  if(logging) {
    do {
      snes.cycle();
      // TODO: some way of tracing the spc again

      // if((snes.xPos % 20) === 0 && snes.apu.spc.cyclesLeft === 0) {
      //   log(getSpcTrace(
      //     snes.apu.spc, snes.apu.cycles
      //   ));
      // }
    } while(
      snes.cpuCyclesLeft > 0 ||
      (snes.xPos >= 536 && snes.xPos < 576) ||
      snes.hdmaTimer > 0
    );
    log(getTrace(
      snes.cpu, snes.frames * 1364 * 262 + snes.yPos * 1364 + snes.xPos
    ));
  } else {
    snes.runFrame(noPpu);
  }

  snes.setPixels(imgData.data);
  ctx.putImageData(imgData, 0, 0);
  snes.setSamples(audioHandler.sampleBufferL, audioHandler.sampleBufferR, audioHandler.samplesPerFrame);
  audioHandler.nextBuffer();
}

function update() {
  runFrame();
  loopId = requestAnimationFrame(update);
}

window.onkeydown = function(e) {
  switch(e.key) {
    case "l":
    case "L": {
      logging = !logging;
      break;
    }
    case "p":
    case "P": {
      noPpu = !noPpu;
      break;
    }
  }
  if(controlsP1[e.key.toLowerCase()] !== undefined) {
    e.preventDefault();
    snes.setPad1ButtonPressed(controlsP1[e.key.toLowerCase()]);
  }
}

window.onkeyup = function(e) {
  if(controlsP1[e.key.toLowerCase()] !== undefined) {
    e.preventDefault();
    snes.setPad1ButtonReleased(controlsP1[e.key.toLowerCase()]);
  }
}

function log(text) {
  el("log").innerHTML += text + "\n";
  el("log").scrollTop = el("log").scrollHeight;
}

function getByteRep(val) {
  return ("0" + val.toString(16)).slice(-2).toUpperCase();
}

function getWordRep(val) {
  return ("000" + val.toString(16)).slice(-4).toUpperCase();
}

function getLongRep(val) {
  return ("00000" + val.toString(16)).slice(-6).toUpperCase();
}

function clearArray(arr) {
  for(let i = 0; i < arr.length; i++) {
    arr[i] = 0;
  }
}

function el(id) {
  return document.getElementById(id);
}
