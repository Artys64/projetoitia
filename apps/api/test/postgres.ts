// Use the package's native binaries directly. Its wrapper installs an exit hook
// which can mask a node:test failure exit code; tests must own their lifecycle.
import { spawn,execFile,type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { writeFile,chmod,unlink } from 'node:fs/promises'
import { join } from 'node:path'
const exec=promisify(execFile)
export async function localPostgres(directory:string,port:number) {
  const binaries=await import(`@embedded-postgres/${process.platform}-${process.arch}`) as {initdb:string;postgres:string}
  const passwordFile=join(directory,'password')
  await writeFile(passwordFile,'local_admin_password\n',{mode:0o600})
  await chmod(binaries.initdb,0o755);await chmod(binaries.postgres,0o755)
  await exec(binaries.initdb,['-D',join(directory,'data'),'-U','postgres',`--pwfile=${passwordFile}`,'--auth=scram-sha-256','--locale=C','--encoding=UTF8'])
  await unlink(passwordFile)
  let processHandle:ChildProcess|undefined
  const postgres={
    async start(){
      await new Promise<void>((resolve,reject)=>{
        const child=spawn(binaries.postgres,['-D',join(directory,'data'),'-p',String(port),'-h','127.0.0.1','-k',directory],{stdio:['ignore','ignore','pipe']})
        processHandle=child
        const timeout=setTimeout(()=>{child.kill('SIGINT');reject(new Error('PostgreSQL startup timeout'))},15000)
        child.on('error',reject)
        child.on('exit',code=>{clearTimeout(timeout);reject(new Error(`PostgreSQL exited (${code})`))})
        child.stderr!.on('data',(chunk:Buffer)=>{if(chunk.toString().includes('database system is ready to accept connections')){clearTimeout(timeout);resolve()}})
      })
    },
    async stop(){
      const child=processHandle;if(!child||child.exitCode!==null)return
      await new Promise<void>(resolve=>{child.once('exit',()=>resolve());child.kill('SIGINT')});processHandle=undefined
    },
  }
  await postgres.start()
  return postgres
}
