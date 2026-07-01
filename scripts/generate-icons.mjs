// Génère les icônes PNG de la PWA à partir de public/icon.svg (nécessite sharp).
import sharp from 'sharp'
import { mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const svg = readFileSync(resolve('public/icon.svg'))
mkdirSync(resolve('public/icons'), { recursive: true })

const targets = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/maskable-512.png', 512],
  ['public/icons/apple-touch-180.png', 180],
  ['public/favicon.png', 48],
]

for (const [path, size] of targets) {
  await sharp(svg).resize(size, size).png().toFile(resolve(path))
  console.log('✔', path, `${size}×${size}`)
}
