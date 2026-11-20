import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { kill } from '../../../lib/pipeline/runners/tool.mjs'

const fakeChild = pid => {
  const calls = []
  return { pid, calls, kill: s => { calls.push(s); return true } }
}

test('kill on Windows: taskkill ends the whole tree (mvn, go, dotnet workers), not only the launcher', () => {
  const child = fakeChild(4242)
  const ran = []
  kill(child, { platform: 'win32', run: (file, args) => { ran.push([file, ...args]); return { status: 0 } } })
  assert.deepEqual(ran, [['taskkill', '/T', '/F', '/PID', '4242']])
  assert.deepEqual(child.calls, [], 'taskkill did it')
})

test('kill on Windows: when taskkill fails or cannot start, the child itself is still killed', () => {
  for (const run of [() => ({ status: 128 }), () => { throw new Error('ENOENT') }]) {
    const child = fakeChild(4242)
    kill(child, { platform: 'win32', run })
    assert.deepEqual(child.calls, ['SIGKILL'])
  }
  const never = fakeChild(undefined)
  kill(never, { platform: 'win32', run: () => assert.fail('no pid: nothing to taskkill') })
  assert.deepEqual(never.calls, ['SIGKILL'])
})

test('kill on POSIX: the detached process group goes, the grandchild too', { skip: process.platform === 'win32' }, async () => {
  const child = spawn('/bin/sh', ['-c', 'sleep 30 & echo $!; wait'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  const grandchild = Number(await new Promise(done => child.stdout.once('data', d => done(String(d).trim()))))
  const closed = new Promise(done => child.once('close', done))
  kill(child, { run: () => assert.fail('no taskkill on POSIX') })
  await closed
  const alive = () => { try { process.kill(grandchild, 0); return true } catch { return false } }
  for (let i = 0; i < 50 && alive(); i++) await new Promise(r => setTimeout(r, 20))
  assert.equal(alive(), false, 'the sleep in the group is gone')
})
