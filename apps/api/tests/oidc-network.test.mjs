import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir,networkInterfaces } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { permittedAddress } from '../dist/authentication/oidc-network.js';
const execute=promisify(execFile);
test('real pinned HTTPS discovery validates certificates and denies redirects, oversized bodies and stalled responses',async()=>{
  const address=Object.values(networkInterfaces()).flat().find(value=>value?.family==='IPv4'&&!value.internal&&permittedAddress(value.address,true))?.address;
  assert.ok(address,'A non-loopback test interface is required');
  const directory=await mkdtemp(path.join(tmpdir(),'oidc-tls-'));let server;
  try{
    await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1','-subj','/CN=idp.test','-addext','subjectAltName=DNS:idp.test']);
    let requests=0;
    server=createServer({key:await readFile(path.join(directory,'key.pem')),cert:await readFile(path.join(directory,'cert.pem'))},(req,res)=>{
      requests++;if(req.url==='/redirect'){res.writeHead(302,{location:'/valid'}).end();return;}
      if(req.url==='/oversized'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({huge:'x'.repeat(300*1024)}));return;}
      if(req.url==='/slow'){res.writeHead(200,{'content-type':'application/json'});res.flushHeaders();return;}
      res.writeHead(200,{'content-type':'application/json'}).end('{"issuer":"https://idp.test"}');
    });server.listen(0,address);await once(server,'listening');
    const origin=`https://idp.test:${server.address().port}`;
    const moduleUrl=new URL('../dist/authentication/oidc-network.js',import.meta.url).href;
    async function fetch(pathname,trust=true,hostname='idp.test'){
      const script=`import {providerJson} from ${JSON.stringify(moduleUrl)};let lookups=0;try{const body=await providerJson(${JSON.stringify(origin.replace('idp.test',hostname)+pathname)},async()=>{lookups++;return [{address:${JSON.stringify(address)},family:4}]});console.log(JSON.stringify({body,lookups}));}catch(error){console.error(error.message);process.exitCode=1;}`;
      return execute(process.execPath,['--input-type=module','-e',script],{env:{...process.env,NODE_EXTRA_CA_CERTS:trust?path.join(directory,'cert.pem'):'',OIDC_PRIVATE_ORIGINS_JSON:JSON.stringify([origin,origin.replace('idp.test',hostname)])},timeout:10000});
    }
    assert.deepEqual(JSON.parse((await fetch('/valid')).stdout),{body:{issuer:'https://idp.test'},lookups:1});
    await assert.rejects(fetch('/valid',false),error=>/self-signed|certificate/i.test(error.stderr));
    await assert.rejects(fetch('/valid',true,'wrong.test'),error=>/certificate|altname|hostname/i.test(error.stderr));
    const before=requests;await assert.rejects(fetch('/redirect'),error=>/Invalid discovery/.test(error.stderr));assert.equal(requests,before+1,'Redirect target must never be requested');
    await assert.rejects(fetch('/oversized'),error=>/too large/.test(error.stderr));
    await assert.rejects(fetch('/slow'),error=>/timeout/.test(error.stderr));
  }finally{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(directory,{recursive:true,force:true});}
});
