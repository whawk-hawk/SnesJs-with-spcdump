
// オンスクリーンタッチコントローラーの入力を snes.setPad1ButtonPressed/Released に橋渡しする

(function() {

  // ===== 十字キー(斜め入力対応) =====
  // 見た目は上下左右のボタンだが、当たり判定は.tc-dpadエリア全体で行う。
  // エリア中心からの指の位置(角度)によって、上下左右・斜め(2方向同時)を判定する。
  let dirToPad = { up: 4, down: 5, left: 6, right: 7 };
  let dirToClass = { up: "tc-up", down: "tc-down", left: "tc-left", right: "tc-right" };

  document.querySelectorAll("#touch-controls .tc-dpad").forEach(function(zone) {
    let activeDirs = {}; // { up: true, right: true, ... } 現在押されている方向

    function applyDirs(newDirs) {
      // 新しく押された方向
      for(let d in dirToPad) {
        let btn = zone.querySelector("." + dirToClass[d]);
        if(newDirs[d] && !activeDirs[d]) {
          if(loaded) {
            snes.setPad1ButtonPressed(dirToPad[d]);
          }
          if(btn) {
            btn.classList.add("tc-active");
          }
        } else if(!newDirs[d] && activeDirs[d]) {
          if(loaded) {
            snes.setPad1ButtonReleased(dirToPad[d]);
          }
          if(btn) {
            btn.classList.remove("tc-active");
          }
        }
      }
      activeDirs = newDirs;
    }

    function clearDirs() {
      applyDirs({});
    }

    // 座標(clientX, clientY)から、押されているべき方向の組み合わせを判定する
    function dirsFromPoint(clientX, clientY) {
      let rect = zone.getBoundingClientRect();
      let cx = rect.left + rect.width / 2;
      let cy = rect.top + rect.height / 2;
      let dx = clientX - cx;
      let dy = clientY - cy;

      let deadZone = Math.min(rect.width, rect.height) * 0.2;
      let dist = Math.sqrt(dx * dx + dy * dy);
      if(dist < deadZone) {
        return {};
      }

      // 画面のY軸は下向きが正なので、-dyで数学的な「上向きが正」に変換して角度を取る
      let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
      if(angle < 0) {
        angle += 360;
      }

      // 45度ずつ8方向に分割し、斜め方向は隣り合う2方向を同時にtrueにする
      if(angle >= 337.5 || angle < 22.5) {
        return { right: true };
      } else if(angle < 67.5) {
        return { up: true, right: true };
      } else if(angle < 112.5) {
        return { up: true };
      } else if(angle < 157.5) {
        return { up: true, left: true };
      } else if(angle < 202.5) {
        return { left: true };
      } else if(angle < 247.5) {
        return { down: true, left: true };
      } else if(angle < 292.5) {
        return { down: true };
      } else {
        return { down: true, right: true };
      }
    }

    function handlePoint(clientX, clientY) {
      if(audioHandler && audioHandler.hasAudio) {
        audioHandler.unlock();
      }
      applyDirs(dirsFromPoint(clientX, clientY));
    }

    // タッチ操作
    zone.addEventListener("touchstart", function(e) {
      e.preventDefault();
      let t = e.touches[0];
      if(t) {
        handlePoint(t.clientX, t.clientY);
      }
    }, { passive: false });

    zone.addEventListener("touchmove", function(e) {
      e.preventDefault();
      let t = e.touches[0];
      if(t) {
        handlePoint(t.clientX, t.clientY);
      }
    }, { passive: false });

    zone.addEventListener("touchend", function(e) {
      e.preventDefault();
      clearDirs();
    }, { passive: false });

    zone.addEventListener("touchcancel", function(e) {
      e.preventDefault();
      clearDirs();
    }, { passive: false });

    // PCブラウザでのマウス操作にも一応対応(動作確認用)
    let mouseDown = false;
    zone.addEventListener("mousedown", function(e) {
      mouseDown = true;
      handlePoint(e.clientX, e.clientY);
    });
    document.addEventListener("mousemove", function(e) {
      if(mouseDown) {
        handlePoint(e.clientX, e.clientY);
      }
    });
    document.addEventListener("mouseup", function(e) {
      if(mouseDown) {
        mouseDown = false;
        clearDirs();
      }
    });
  });

  // ===== ABXY・L/R・SELECT/START(従来通り、個別ボタンでの押下判定) =====
  let buttons = document.querySelectorAll(
    "#touch-controls .tc-abxy .tc-btn, #touch-controls .tc-shoulders .tc-btn"
  );

  buttons.forEach(function(btn) {
    let padNum = parseInt(btn.getAttribute("data-pad"), 10);

    let press = function(e) {
      e.preventDefault();
      // Safari/iOSの自動再生制限解除にも使う(ユーザー操作の中でunlockを呼ぶ)
      if(audioHandler && audioHandler.hasAudio) {
        audioHandler.unlock();
      }
      if(loaded) {
        snes.setPad1ButtonPressed(padNum);
      }
    }

    let release = function(e) {
      e.preventDefault();
      if(loaded) {
        snes.setPad1ButtonReleased(padNum);
      }
    }

    // タッチ操作
    btn.addEventListener("touchstart", press, { passive: false });
    btn.addEventListener("touchend", release, { passive: false });
    btn.addEventListener("touchcancel", release, { passive: false });

    // PCブラウザでのマウス操作にも一応対応(動作確認用)
    btn.addEventListener("mousedown", press);
    btn.addEventListener("mouseup", release);
    btn.addEventListener("mouseleave", release);
  });

  // 画面のどこかを最初にタップした時点でAudioContextのロックを解除する保険
  document.addEventListener("touchstart", function() {
    if(audioHandler && audioHandler.hasAudio) {
      audioHandler.unlock();
    }
  }, { passive: true });
})();
