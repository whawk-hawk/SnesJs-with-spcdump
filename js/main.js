
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

// ダンプファイル名生成用: 読み込んだROMの拡張子抜きファイル名と、
// 通常ダンプ/イントロ自動ダンプそれぞれの通し番号
let currentRomName = "rom";
let normalDumpCount = 0;
let introDumpCount = 0;

function stripExt(name) {
  let idx = name.lastIndexOf(".");
  return idx > 0 ? name.slice(0, idx) : name;
}

function pad2(n) {
  return (n < 10 ? "0" : "") + n;
}

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
              currentRomName = stripExt(name);
              normalDumpCount = 0;
              introDumpCount = 0;
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
      currentRomName = stripExt(e.target.files[0].name);
      normalDumpCount = 0;
      introDumpCount = 0;
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

el("dumpspc").onclick = function(e) {
  if(loaded) {
    normalDumpCount++;
    downloadSpc(snes, currentRomName + "_" + pad2(normalDumpCount) + ".spc");
  }
}

// dsp.js側(イントロ自動ダンプ)から、発火のたびに次のファイル名を取得するために呼ばれる
window.getNextIntroDumpFilename = function() {
  introDumpCount++;
  return "intro_" + currentRomName + "_" + pad2(introDumpCount) + ".spc";
}

const ARM_LABEL_IDLE = "イントロ録音待機(次のKeyOnで自動ダンプ)";
const ARM_LABEL_ARMED = "待機中... (最初の発音でSPCを自動保存)";

// armdumpボタンがindex.html側に無い(反映漏れ)場合でも、
// ここでエラーになって以降の初期化(全画面ボタン等)が止まらないようにする
let armdumpBtn = el("armdump");
if(armdumpBtn) {
  armdumpBtn.onclick = function(e) {
    if(!loaded) {
      return;
    }
    // トグル: 押すたびに待機ON/OFFを切り替える
    snes.apu.dsp.autoDumpArmed = !snes.apu.dsp.autoDumpArmed;
    armdumpBtn.textContent = snes.apu.dsp.autoDumpArmed ? ARM_LABEL_ARMED : ARM_LABEL_IDLE;
  }
} else {
  log("警告: #armdump ボタンがHTMLに見つかりません。index.htmlが未反映の可能性があります。");
}

// dsp.js側から、自動ダンプが実際に発火した瞬間に呼ばれる
// (dsp.jsは古典的なグローバルスクリプトなので、windowに生やして参照する)
window.onAutoDumpFired = function() {
  if(armdumpBtn) {
    armdumpBtn.textContent = ARM_LABEL_IDLE;
  }
}

el("fullscreen").onclick = function(e) {
  let container = el("game-container");
  if(!document.fullscreenElement) {
    if(container.requestFullscreen) {
      container.requestFullscreen();
    } else if(container.webkitRequestFullscreen) {
      // iOS Safariでの互換用(iOSはcanvas/div全体の全画面に対応していない場合がある)
      container.webkitRequestFullscreen();
    }
  } else {
    if(document.exitFullscreen) {
      document.exitFullscreen();
    } else if(document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    }
  }
}

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
