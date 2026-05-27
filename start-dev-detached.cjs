const { spawn } = require('node:child_process')
const projectRoot = __dirname
const isWindows = process.platform === 'win32'
const command = isWindows ? 'cmd.exe' : 'npm'
const args = isWindows
  ? ['/c', 'npm run dev -- --host 127.0.0.1 --port 5173']
  : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173']

const child = spawn(command, args, {
  cwd: projectRoot,
  detached: true,
  stdio: 'ignore',
  windowsHide: false,
})

child.unref()
console.log(`Eatery MVP dev server started. PID: ${child.pid}`)
console.log('Open: http://localhost:5173/?view=customer')