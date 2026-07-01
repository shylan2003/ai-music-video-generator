const fs = require('node:fs')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const requestedArgs = process.argv.slice(2)

const candidates = []
if (process.env.PYTHON) candidates.push({ command: process.env.PYTHON, prefix: [] })
candidates.push({
  command: path.join(root, '.venv', process.platform === 'win32' ? 'Scripts' : 'bin', process.platform === 'win32' ? 'python.exe' : 'python'),
  prefix: [],
})

if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
  const pythonRoot = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python')
  try {
    const versions = fs.readdirSync(pythonRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Python\d+$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .reverse()
    for (const version of versions) {
      candidates.push({ command: path.join(pythonRoot, version, 'python.exe'), prefix: [] })
    }
  } catch {
    // The project virtual environment or PATH candidates can still be used.
  }
}

candidates.push({ command: process.platform === 'win32' ? 'python.exe' : 'python3', prefix: [] })
candidates.push({ command: 'python', prefix: [] })
if (process.platform === 'win32') candidates.push({ command: 'py', prefix: ['-3'] })

const selected = candidates.find(({ command, prefix }) => {
  if (path.isAbsolute(command) && !fs.existsSync(command)) return false
  const result = spawnSync(command, [...prefix, '--version'], {
    cwd: root,
    stdio: 'ignore',
    windowsHide: true,
    timeout: 10_000,
  })
  return result.status === 0
})

if (!selected) {
  console.error('未找到可用的 Python。请先创建 .venv，或设置 PYTHON 环境变量。')
  process.exit(1)
}

const child = spawn(selected.command, [...selected.prefix, ...requestedArgs], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}

child.on('error', (error) => {
  console.error(`Python 启动失败：${error.message}`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
