
// オンスクリーンタッチコントローラーの入力を snes.setPad1ButtonPressed/Released に橋渡しする

(function() {
  let buttons = document.querySelectorAll("#touch-controls .tc-btn");

  buttons.forEach(function(btn) {
    let padNum = parseInt(btn.getAttribute("data-pad"), 10);

    let press = function(e) {
      e.preventDefault();
      // Safari/iOSの自動再生制限解除にも使う(ユーザー操作の中でresumeを呼ぶ)
      if(audioHandler && audioHandler.hasAudio) {
        audioHandler.resume();
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

  // 画面のどこかを最初にタップした時点でAudioContextを再開させる保険
  document.addEventListener("touchstart", function() {
    if(audioHandler && audioHandler.hasAudio) {
      audioHandler.resume();
    }
  }, { passive: true });
})();
