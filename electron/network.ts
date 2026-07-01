import net from 'net'

export function findAvailableLoopbackPort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => {
        if (error) reject(error)
        else if (port > 0) resolve(port)
        else reject(new Error('无法分配本地后端端口'))
      })
    })
  })
}
