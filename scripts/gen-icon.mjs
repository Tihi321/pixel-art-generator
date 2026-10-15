// Writes build/icon.png (256x256), the app icon electron-builder turns into the .exe / installer icon.
// Run with `yarn gen:icon` after changing the sprite below.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const COLORS = {
  '.': null,
  K: [0x1a, 0x1c, 0x2c],
  D: [0x33, 0x3c, 0x57],
  R: [0xb1, 0x3e, 0x53],
  Y: [0xff, 0xcd, 0x75],
  G: [0x38, 0xb7, 0x64],
  B: [0x41, 0xa6, 0xf6],
  W: [0xf4, 0xf4, 0xf4]
}

const SPRITE = [
  '..KKKKKKKKKKKK..',
  '.KDDDDDDDDDDDDK.',
  'KDDDDDDDDDDDDDDK',
  'KDDWRRRDDWYYYDDK',
  'KDDRRRRDDYYYYDDK',
  'KDDRRRRDDYYYYDDK',
  'KDDRRRRDDYYYYDDK',
  'KDDDDDDDDDDDDDDK',
  'KDDDDDDDDDDDDDDK',
  'KDDWGGGDDWBBBDDK',
  'KDDGGGGDDBBBBDDK',
  'KDDGGGGDDBBBBDDK',
  'KDDGGGGDDBBBBDDK',
  'KDDDDDDDDDDDDDDK',
  '.KDDDDDDDDDDDDK.',
  '..KKKKKKKKKKKK..'
]

const SIZE = 256
const SCALE = SIZE / SPRITE.length

// RGBA scanlines, each prefixed with filter byte 0.
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1))
for (let y = 0; y < SIZE; y++) {
  const row = y * (SIZE * 4 + 1)
  for (let x = 0; x < SIZE; x++) {
    const c = COLORS[SPRITE[Math.floor(y / SCALE)][Math.floor(x / SCALE)]]
    if (c) raw.set([...c, 255], row + 1 + x * 4)
  }
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0))
])

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png')
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, png)
console.log(`wrote ${out}`)
