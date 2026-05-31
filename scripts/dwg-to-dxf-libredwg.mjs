import { access } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const DEFAULT_EXE = path.resolve('tools/libredwg/0.13.4-win64/dwg2dxf.exe')

function usage() {
  console.log([
    'Usage:',
    '  npm run dwg:dxf:libredwg -- <input.dwg> [output.dxf] [--as r2013] [--minimal]',
    '',
    'Examples:',
    '  npm run dwg:dxf:libredwg -- ./floor.dwg',
    '  npm run dwg:dxf:libredwg -- ./floor.dwg ./floor.dxf --as r2013',
    '',
    'Env:',
    '  LIBREDWG_DWG2DXF can point to dwg2dxf.exe if it is installed elsewhere.',
  ].join('\n'))
}

function parseArgs(argv) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    return { help: true }
  }

  const positional = []
  const passthrough = ['-y', '--overwrite']
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--as') {
      const value = argv[++i]
      if (!value) throw new Error('--as 缺少版本，例如 r2013')
      passthrough.push('--as', value)
      continue
    }
    if (arg === '--minimal' || arg === '-m') {
      passthrough.push('--minimal')
      continue
    }
    positional.push(arg)
  }

  return {
    inputPath: positional[0],
    outputPath: positional[1],
    passthrough,
  }
}

async function assertExists(filePath, label) {
  try {
    await access(filePath)
  } catch {
    throw new Error(`${label} 不存在: ${filePath}`)
  }
}

function run(exe, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { stdio: 'inherit', shell: false })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) resolve()
      else reject(new Error(`LibreDWG dwg2dxf 失敗，exit code ${code}`))
    })
  })
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.help) {
    usage()
    return
  }
  if (!opts.inputPath) {
    usage()
    throw new Error('缺少 input.dwg')
  }

  const exe = path.resolve(process.env.LIBREDWG_DWG2DXF || DEFAULT_EXE)
  const inputPath = path.resolve(opts.inputPath)
  const outputPath = opts.outputPath ? path.resolve(opts.outputPath) : null

  await assertExists(exe, 'dwg2dxf.exe')
  await assertExists(inputPath, 'input DWG')

  const args = [...opts.passthrough]
  if (outputPath) args.push('-o', outputPath)
  args.push(inputPath)

  await run(exe, args)
}

main().catch(error => {
  console.error(error.message || error)
  process.exitCode = 1
})
