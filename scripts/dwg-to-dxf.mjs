import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

async function loadEnvFile(filePath) {
  try {
    const text = await readFile(filePath, 'utf8')
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim()
      if (!line || line.startsWith('#')) continue
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
      if (!match) continue
      const [, key, rawValue] = match
      if (process.env[key]) continue
      process.env[key] = rawValue.replace(/^['"]|['"]$/g, '')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
}

function usage() {
  console.log([
    'Usage:',
    '  npm run dwg:dxf -- <input.dwg> [output.dxf] [--engine <engine>]',
    '',
    'Examples:',
    '  npm run dwg:dxf -- ./floor.dwg',
    '  npm run dwg:dxf -- ./floor.dwg ./floor.dxf',
    '',
    'Env:',
    '  VITE_CLOUDCONVERT_API_KEY or CLOUDCONVERT_API_KEY',
  ].join('\n'))
}

function parseArgs(argv) {
  const args = [...argv]
  if (!args.length || args.includes('--help') || args.includes('-h')) {
    return { help: true }
  }

  let engine = null
  const positional = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--engine') {
      engine = args[++i] || null
      continue
    }
    positional.push(arg)
  }

  return {
    inputPath: positional[0],
    outputPath: positional[1],
    engine,
  }
}

async function main() {
  const cwd = process.cwd()
  await loadEnvFile(path.join(cwd, '.env.local'))
  await loadEnvFile(path.join(cwd, '.env'))

  const apiKey = process.env.VITE_CLOUDCONVERT_API_KEY || process.env.CLOUDCONVERT_API_KEY
  if (!apiKey) {
    throw new Error('缺少 VITE_CLOUDCONVERT_API_KEY。請先寫入 .env.local。')
  }
  globalThis.__CLOUDCONVERT_API_KEY__ = apiKey

  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return
  }
  if (!opts.inputPath) {
    usage()
    throw new Error('缺少 input.dwg')
  }

  const inputPath = path.resolve(cwd, opts.inputPath)
  const outputPath = path.resolve(
    cwd,
    opts.outputPath || inputPath.replace(/\.dwg$/i, '.dxf')
  )

  if (inputPath === outputPath) {
    throw new Error('輸入與輸出路徑相同，請指定 .dxf 輸出檔。')
  }

  const bytes = await readFile(inputPath)
  const dwgFile = new File([bytes], path.basename(inputPath), {
    type: 'application/acad',
  })

  const { convertDwgToDxf } = await import('../src/lib/dwgConvert.js')
  const converted = await convertDwgToDxf(dwgFile, {
    onProgress(stage, message) {
      console.log(`[${stage}] ${message}`)
    },
  }, opts.engine)

  const arrayBuffer = await converted.arrayBuffer()
  await writeFile(outputPath, Buffer.from(arrayBuffer))
  console.log(`完成: ${outputPath}`)
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
