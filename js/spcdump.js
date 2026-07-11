
// SPCファイル(v0.30フォーマット)を、現在のAPU状態から生成する
// 参考: 一般的に流通しているSPC file format spec (header 33 bytes, id666 tag,
// 64KB RAM, 128 byte DSP regs, 64 byte unused, 64 byte extra RAM)

const SPC_TOTAL_SIZE = 0x10200; // 66048 bytes

function dumpSpc(snes) {
  const apu = snes.apu;
  const spc = apu.spc;
  const dsp = apu.dsp;

  // register index constants (spc.js内のprivateな定数と同じ並び)
  const A = 0, X = 1, Y = 2, SP = 3, PC = 0;

  let out = new Uint8Array(SPC_TOTAL_SIZE);

  // --- header (33 bytes) ---
  let header = "SNES-SPC700 Sound File Data v0.30";
  for(let i = 0; i < header.length; i++) {
    out[i] = header.charCodeAt(i);
  }

  // --- has-ID666-tag marker ---
  out[0x21] = 0x1a;
  out[0x22] = 0x1a;
  out[0x23] = 0x1b; // 0x1b = ID666タグなし (0x1aだとタグありとみなされる)
  out[0x24] = 30;   // バージョン(0.30)

  // --- CPU registers ---
  let pc = spc.br[PC] & 0xffff;
  out[0x25] = pc & 0xff;
  out[0x26] = (pc >> 8) & 0xff;
  out[0x27] = spc.r[A] & 0xff;
  out[0x28] = spc.r[X] & 0xff;
  out[0x29] = spc.r[Y] & 0xff;

  // PSW: bit7=N,6=V,5=P,4=B,3=H,2=I,1=Z,0=C
  let psw = 0;
  if(spc.n) psw |= 0x80;
  if(spc.v) psw |= 0x40;
  if(spc.p) psw |= 0x20;
  if(spc.b) psw |= 0x10;
  if(spc.h) psw |= 0x08;
  if(spc.i) psw |= 0x04;
  if(spc.z) psw |= 0x02;
  if(spc.c) psw |= 0x01;
  out[0x2a] = psw;

  out[0x2b] = spc.r[SP] & 0xff;
  // 0x2c-0x2d reserved, leave as 0
  // 0x2e-0xff : ID666 tag data域。タグなしなので0埋めのまま

  // --- 64KB APU RAM ---
  out.set(apu.ram, 0x100);

  // --- 128 byte DSP registers ---
  out.set(dsp.ram, 0x10100);

  // 0x10180-0x101c0 : unused (0埋めのまま)

  // --- extra RAM ($FFC0-$FFFF のミラー、64 bytes) ---
  for(let i = 0; i < 64; i++) {
    out[0x101c0 + i] = apu.ram[0xffc0 + i];
  }

  return out;
}

function downloadSpc(snes, filename) {
  let data = dumpSpc(snes);
  let blob = new Blob([data], { type: "application/octet-stream" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = filename || "dump.spc";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
