const assert = require('node:assert/strict')
const net = require('node:net')
const { findAvailableLoopbackPort } = require('../dist-electron/network.js')

async function main() {
  const port = await findAvailableLoopbackPort()
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)

  await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close(resolve))
  })
  console.log(`backend port allocation passed: ${port}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
