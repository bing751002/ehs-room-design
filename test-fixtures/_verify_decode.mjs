// 驗證 decodeDxfText 嗅探:新 UTF-8 (2018) 檔要能抽到牆線,layer 名不亂碼。
// 用法: node --max-old-space-size=6144 test-fixtures/_verify_decode.mjs
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const DxfParser = (m => m.default || m)(require('dxf-parser'))
import { decodeDxfText } from '../src/lib/dxfSpaceExtract.js'
import { extractDxfPreviewContent } from '../src/lib/dxfPreview.js'

const ARCH = ['隔間牆', '承重柱牆', '牆體', '門', '樓梯', '防火', '帷幕']
const KEEP = ['地面造型', '天花造型', '門窗上框線']

function run(path) {
  if (!fs.existsSync(path)) { console.log('SKIP (不存在):', path); return }
  const buf = fs.readFileSync(path)
  const text = decodeDxfText(buf)
  const dxf = new DxfParser().parseSync(text)
  const layers = Object.keys(dxf.tables?.layer?.layers || {})
  const garbled = layers.filter(n => /�/.test(n)).length
  const arch = layers.filter(n => ARCH.some(w => n.includes(w)))
  const keep = layers.filter(n => KEEP.some(w => n.includes(w)))
  const preview = extractDxfPreviewContent(dxf)
  console.log('檔案:', path.split(/[\\/]/).pop())
  console.log(`  layers=${layers.length} 亂碼=${garbled} ARCH命中=${arch.length} KEEP命中=${keep.length}`)
  console.log(`  保留結構線=${preview.lines.length} (raw ${preview.rawLineCount})`)
  console.log(`  ARCH: ${arch.slice(0, 5).join(' / ') || '(無)'}`)
  console.log(`  PASS: ${garbled === 0 && preview.lines.length > 0 ? '✓' : '✗ 仍有問題'}`)
  console.log('')
}

const dir = 'test-fixtures'
// 新檔 (2018, UTF-8)
run(`${dir}/260528 東森林口辦公室22F.dxf`)
// 舊檔 (2004, Big5) — 確認沒改壞;不存在就 SKIP
for (const name of fs.readdirSync(dir)) {
  if (/office22F.*\.dxf$/i.test(name)) run(`${dir}/${name}`)
}
