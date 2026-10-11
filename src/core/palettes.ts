// Built-in palettes, embedded so the renderer and tools work without a filesystem.
// The same data is mirrored in seed/palettes/*.hex (a test keeps them in sync).

import type { Palette } from './model'

interface BuiltinDef {
  id: string
  name: string
  hexes: string[]
  names?: string[]
  description: string
}

const DEFS: BuiltinDef[] = [
  {
    id: 'pico-8',
    name: 'PICO-8',
    description: 'The 16 fixed colors of the PICO-8 fantasy console.',
    hexes: [
      '000000', '1d2b53', '7e2553', '008751', 'ab5236', '5f574f', 'c2c3c7', 'fff1e8',
      'ff004d', 'ffa300', 'ffec27', '00e436', '29adff', '83769c', 'ff77a8', 'ffccaa'
    ],
    names: [
      'black', 'dark-blue', 'dark-purple', 'dark-green', 'brown', 'dark-gray', 'light-gray', 'white',
      'red', 'orange', 'yellow', 'green', 'blue', 'lavender', 'pink', 'light-peach'
    ]
  },
  {
    id: 'sweetie-16',
    name: 'Sweetie 16',
    description: 'Sweetie 16 by GrafxKid: a balanced 16-color palette.',
    hexes: [
      '1a1c2c', '5d275d', 'b13e53', 'ef7d57', 'ffcd75', 'a7f070', '38b764', '257179',
      '29366f', '3b5dc9', '41a6f6', '73eff7', 'f4f4f4', '94b0c2', '566c86', '333c57'
    ]
  },
  {
    id: 'db16',
    name: 'DawnBringer 16',
    description: 'DawnBringer 16 (DB16).',
    hexes: [
      '140c1c', '442434', '30346d', '4e4a4e', '854c30', '346524', 'd04648', '757161',
      '597dce', 'd27d2c', '8595a1', '6daa2c', 'd2aa99', '6dc2ca', 'dad45e', 'deeed6'
    ]
  },
  {
    id: 'db32',
    name: 'DawnBringer 32',
    description: 'DawnBringer 32 (DB32).',
    hexes: [
      '000000', '222034', '45283c', '663931', '8f563b', 'df7126', 'd9a066', 'eec39a',
      'fbf236', '99e550', '6abe30', '37946e', '4b692f', '524b24', '323c39', '3f3f74',
      '306082', '5b6ee1', '639bff', '5fcde4', 'cbdbfc', 'ffffff', '9badb7', '847e87',
      '696a6a', '595652', '76428a', 'ac3232', 'd95763', 'd77bba', '8f974a', '8a6f30'
    ]
  },
  {
    id: 'endesga-32',
    name: 'Endesga 32',
    description: 'ENDESGA 32 by Endesga.',
    hexes: [
      'be4a2f', 'd77643', 'ead4aa', 'e4a672', 'b86f50', '733e39', '3e2731', 'a22633',
      'e43b44', 'f77622', 'feae34', 'fee761', '63c74d', '3e8948', '265c42', '193c3e',
      '124e89', '0099db', '2ce8f5', 'ffffff', 'c0cbdc', '8b9bb4', '5a6988', '3a4466',
      '262b44', '181425', 'ff0044', '68386c', 'b55088', 'f6757a', 'e8b796', 'c28569'
    ]
  },
  {
    id: 'endesga-64',
    name: 'Endesga 64',
    description: 'ENDESGA 64 by Endesga.',
    hexes: [
      'ff0040', '131313', '1b1b1b', '272727', '3d3d3d', '5d5d5d', '858585', 'b4b4b4',
      'ffffff', 'c7cfdd', '92a1b9', '657392', '424c6e', '2a2f4e', '1a1932', '0e071b',
      '1c121c', '391f21', '5d2c28', '8a4836', 'bf6f4a', 'e69c69', 'f6ca9f', 'f9e6cf',
      'edab50', 'e07438', 'c64524', '8e251d', 'ff5000', 'ed7614', 'ffa214', 'ffc825',
      'ffeb57', 'd3fc7e', '99e65f', '5ac54f', '33984b', '1e6f50', '134c4c', '0c2e44',
      '00396d', '0069aa', '0098dc', '00cdf9', '0cf1ff', '94fdff', 'fdd2ed', 'f389f5',
      'db3ffd', '7a09fa', '3003d9', '0c0293', '03193f', '3b1443', '622461', '93388f',
      'ca52c9', 'c85086', 'f68187', 'f5555d', 'ea323c', 'c42430', '891e2b', '571c27'
    ]
  },
  {
    id: 'gameboy',
    name: 'Game Boy (DMG)',
    description: 'The 4 greens of the original Game Boy, dark to light.',
    hexes: ['0f380f', '306230', '8bac0f', '9bbc0f'],
    names: ['darkest', 'dark', 'light', 'lightest']
  },
  {
    id: 'nes',
    name: 'NES (approx)',
    description: 'An approximation of the NES PPU palette (55 unique colors).',
    hexes: [
      '7c7c7c', '0000fc', '0000bc', '4428bc', '940084', 'a80020', 'a81000', '881400',
      '503000', '007800', '006800', '005800', '004058', '000000',
      'bcbcbc', '0078f8', '0058f8', '6844fc', 'd800cc', 'e40058', 'f83800', 'e45c10',
      'ac7c00', '00b800', '00a800', '00a844', '008888',
      'f8f8f8', '3cbcfc', '6888fc', '9878f8', 'f878f8', 'f85898', 'f87858', 'fca044',
      'f8b800', 'b8f818', '58d854', '58f898', '00e8d8', '787878',
      'fcfcfc', 'a4e4fc', 'b8b8f8', 'd8b8f8', 'f8b8f8', 'f8a4c0', 'f0d0b0', 'fce0a8',
      'f8d878', 'd8f878', 'b8f8b8', 'b8f8d8', '00fcfc', 'f8d8f8'
    ]
  },
  {
    id: 'resurrect-64',
    name: 'Resurrect 64',
    description: 'Resurrect 64 by Kerrie Lake.',
    hexes: [
      '2e222f', '3e3546', '625565', '966c6c', 'ab947a', '694f62', '7f708a', '9babb2',
      'c7dcd0', 'ffffff', '6e2727', 'b33831', 'ea4f36', 'f57d4a', 'ae2334', 'e83b3b',
      'fb6b1d', 'f79617', 'f9c22b', '7a3045', '9e4539', 'cd683d', 'e6904e', 'fbb954',
      '4c3e24', '676633', 'a2a947', 'd5e04b', 'fbff86', '165a4c', '239063', '1ebc73',
      '91db69', 'cddf6c', '313638', '374e4a', '547e64', '92a984', 'b2ba90', '0b5e65',
      '0b8a8f', '0eaf9b', '30e1b9', '8ff8e2', '323353', '484a77', '4d65b4', '4d9be6',
      '8fd3ff', '45293f', '6b3e75', '905ea9', 'a884f3', 'eaaded', '753c54', 'a24b6f',
      'cf657f', 'ed8099', '831c5d', 'c32454', 'f04f78', 'f68181', 'fca790', 'fdcbb0'
    ]
  },
  {
    id: 'cga',
    name: 'CGA (16)',
    description: 'The 16-color CGA/EGA text-mode palette.',
    hexes: [
      '000000', '0000aa', '00aa00', '00aaaa', 'aa0000', 'aa00aa', 'aa5500', 'aaaaaa',
      '555555', '5555ff', '55ff55', '55ffff', 'ff5555', 'ff55ff', 'ffff55', 'ffffff'
    ]
  }
]

function build(def: BuiltinDef): Palette {
  return {
    id: def.id,
    name: def.name,
    colors: def.hexes.map((h, i) => {
      const name = def.names?.[i]
      return name ? { hex: `#${h}`, name } : { hex: `#${h}` }
    })
  }
}

export const BUILTIN_PALETTES: readonly Palette[] = DEFS.map(build)

export interface BuiltinPaletteInfo {
  id: string
  name: string
  size: number
  description: string
}

export function listBuiltinPalettes(): BuiltinPaletteInfo[] {
  return DEFS.map((d) => ({ id: d.id, name: d.name, size: d.hexes.length, description: d.description }))
}

/** Look up by id or name (case-insensitive, ignoring spaces/dashes). Returns a fresh copy. */
export function getBuiltinPalette(idOrName: string): Palette | undefined {
  const norm = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, '')
  const key = norm(idOrName)
  const idx = DEFS.findIndex((d) => norm(d.id) === key || norm(d.name) === key)
  if (idx < 0) return undefined
  const p = BUILTIN_PALETTES[idx]!
  return { id: p.id, name: p.name, colors: p.colors.map((c) => ({ ...c })) }
}

/** The .hex (Lospec) text for a builtin palette, as stored in seed/palettes. */
export function builtinPaletteHexText(id: string): string {
  const def = DEFS.find((d) => d.id === id)
  if (!def) throw new Error(`Unknown builtin palette "${id}".`)
  return def.hexes.join('\n') + '\n'
}
