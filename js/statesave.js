// ステートセーブ/ロード機能
//
// snes/*.js の各モジュール(Cpu, Ppu, Apu, Spc, Dsp, Cart, Snes本体)は、
// レジスタやフラグ、バッファ類をすべて `this.xxx` というプロパティとして
// 素直に持っている作りになっている。そのため、各モジュールの中身を
// 「関数と、親/兄弟モジュールへの参照(循環参照になる部分)を除いて、
// プロパティを丸ごとコピーする」という汎用的な処理で保存・復元できる。
//
// 保存されるのは以下の情報:
// - Snes本体: DMA/HDMAの状態、割り込み・IOポート関連、フレームカウンタ等
// - Cpu: レジスタ、フラグ、実行状態
// - Ppu: VRAM/CGRAM/OAM、レンダリング関連の内部状態
//   (ただし直近フレームの描画結果である pixelOutput は再現不要なため除外)
// - Apu/Spc/Dsp: APU RAM、SPC700レジスタ、DSPの各チャンネル状態など
// - Cart: SRAM(バッテリーセーブ)やヘッダ情報
//   (ROM本体のバイナリ(data)はセーブファイルに含めない。ロード時は
//   ユーザーが同じROMを読み込んでいる前提とし、ROM名・サイズが一致するかだけ確認する)

const STATE_SAVE_VERSION = 3;

// TypedArrayの中身(バイト列)をBase64文字列に変換する
// (巨大な配列でもコールスタックを溢れさせないよう、チャンクに分けて処理する)
function ssBytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for(let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(
      null, bytes.subarray(i, i + chunkSize)
    );
  }
  return btoa(binary);
}

function ssBase64ToBytes(base64) {
  let binary = atob(base64);
  let bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// 値を再帰的に「保存用のプレーンな値」に変換する
function ssSnapshotValue(val) {
  if(val === null || val === undefined) {
    return val;
  }
  if(ArrayBuffer.isView(val)) {
    // TypedArray (Uint8Array, Uint16Array, Int32Array, Float64Array, ...)
    // 1要素ずつJSONの数値配列にすると非常に遅く・大きくなるため、
    // バイト列のままBase64文字列にまとめて保存する
    let bytes = new Uint8Array(val.buffer, val.byteOffset, val.byteLength);
    return { __ta: val.constructor.name, b: ssBytesToBase64(bytes) };
  }
  if(Array.isArray(val)) {
    // 通常の配列(bool/numberの配列など、サイズが小さいのでそのままでよい)
    return val.map(ssSnapshotValue);
  }
  if(typeof val === "object") {
    return ssSnapshotObject(val, []);
  }
  // number, boolean, string
  return val;
}

// 配列の要素に関数が含まれるかどうか
// (cpu.js/spc.jsが持つ、オペコードごとの処理関数を並べたディスパッチテーブル
// (this.functions)がこれに該当する。JSON.stringifyは配列内の関数を
// 黙ってnullに変換してしまうため、保存対象から除外する必要がある)
function ssIsFunctionArray(arr) {
  for(let i = 0; i < arr.length; i++) {
    if(typeof arr[i] === "function") {
      return true;
    }
  }
  return false;
}

// オブジェクトの「関数ではない自分自身のプロパティ」を、
// excludeKeysに含まれるもの(親/兄弟モジュールへの参照など)を除いて保存する
function ssSnapshotObject(obj, excludeKeys) {
  let out = {};
  for(let key of Object.keys(obj)) {
    if(excludeKeys.indexOf(key) !== -1) {
      continue;
    }
    let val = obj[key];
    if(typeof val === "function") {
      continue;
    }
    if(Array.isArray(val) && ssIsFunctionArray(val)) {
      continue;
    }
    out[key] = ssSnapshotValue(val);
  }
  return out;
}

// 保存された値を、現在のインスタンス(current)に復元する
function ssRestoreValue(current, val) {
  if(val === null || val === undefined) {
    return val;
  }
  if(typeof val === "object" && val.__ta) {
    // Base64からTypedArrayを復元
    let bytes = ssBase64ToBytes(val.b);
    let Ctor = window[val.__ta] || Uint8Array;
    if(
      current && ArrayBuffer.isView(current) &&
      current.byteLength === bytes.byteLength
    ) {
      // 既存の配列があり長さが同じならその場で書き換える
      // (他のコードがそのTypedArrayへの参照を保持している場合があるため、
      // 極力元の参照は保ったまま中身だけ差し替える)
      new Uint8Array(
        current.buffer, current.byteOffset, current.byteLength
      ).set(bytes);
      return current;
    }
    // bytes.bufferは復元用に新しく作られた、ぴったりのサイズのバッファなので
    // そのままTypedArrayとして被せ直せる
    return new Ctor(bytes.buffer);
  }
  if(Array.isArray(val)) {
    return val.slice();
  }
  if(typeof val === "object") {
    if(current && typeof current === "object") {
      ssRestoreObject(current, val, []);
      return current;
    }
    return val;
  }
  return val;
}

function ssRestoreObject(obj, data, excludeKeys) {
  for(let key of Object.keys(data)) {
    if(excludeKeys.indexOf(key) !== -1) {
      continue;
    }
    if(!(key in obj)) {
      // 未知のキー(バージョン差異等)は無視する
      continue;
    }
    obj[key] = ssRestoreValue(obj[key], data[key]);
  }
}

// snesインスタンス全体のスナップショットを作る
function snapshotSnesState(snes) {
  let state = {
    version: STATE_SAVE_VERSION,
    snes: ssSnapshotObject(snes, ["cpu", "ppu", "apu", "cart"]),
    cpu: ssSnapshotObject(snes.cpu, ["mem"]),
    ppu: ssSnapshotObject(snes.ppu, ["snes", "pixelOutput"]),
    apu: ssSnapshotObject(snes.apu, ["snes", "spc", "dsp", "bootRom"])
  };
  state.apu.spc = ssSnapshotObject(snes.apu.spc, ["mem"]);
  state.apu.dsp = ssSnapshotObject(snes.apu.dsp, ["apu"]);

  if(snes.cart) {
    state.cart = ssSnapshotObject(snes.cart, ["data"]);
    // ロード時にROMの取り違えがないか確認するための情報
    state.cartCheck = {
      name: snes.cart.header.name,
      romSize: snes.cart.header.romSize,
      isHirom: snes.cart.isHirom
    };
  } else {
    state.cart = null;
  }

  return state;
}

// スナップショットをsnesインスタンスに復元する
// 戻り値: { ok: true } または { ok: false, error: "説明" }
function restoreSnesState(snes, state) {
  if(!state || typeof state !== "object") {
    return { ok: false, error: "ステートデータの形式が正しくありません" };
  }
  if(state.version !== STATE_SAVE_VERSION) {
    return {
      ok: false,
      error: "セーブデータの形式が古い/新しいため読み込めません" +
        "(データ: v" + state.version + ", 対応: v" + STATE_SAVE_VERSION + ")"
    };
  }
  if(!snes.cart) {
    return { ok: false, error: "先にROMを読み込んでください" };
  }
  if(state.cartCheck) {
    let c = state.cartCheck;
    if(
      c.name !== snes.cart.header.name ||
      c.romSize !== snes.cart.header.romSize ||
      c.isHirom !== snes.cart.isHirom
    ) {
      return {
        ok: false,
        error: "現在読み込まれているROMと、セーブデータのROMが一致しません" +
          "(セーブ時のROM: \"" + c.name + "\")"
      };
    }
  }

  ssRestoreObject(snes, state.snes, ["cpu", "ppu", "apu", "cart"]);
  ssRestoreObject(snes.cpu, state.cpu, ["mem"]);
  ssRestoreObject(snes.ppu, state.ppu, ["snes", "pixelOutput"]);
  ssRestoreObject(snes.apu, state.apu, ["snes", "spc", "dsp"]);
  ssRestoreObject(snes.apu.spc, state.apu.spc, ["mem"]);
  ssRestoreObject(snes.apu.dsp, state.apu.dsp, ["apu"]);
  if(state.cart) {
    ssRestoreObject(snes.cart, state.cart, ["data"]);
  }

  return { ok: true };
}

// ステートをJSONファイルとしてダウンロードする
function downloadState(snes, filename) {
  let state = snapshotSnesState(snes);
  let json = JSON.stringify(state);
  let blob = new Blob([json], { type: "application/json" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = filename || "savestate.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}