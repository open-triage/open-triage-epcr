import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir,networkInterfaces } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { generateKeyPairSync } from 'node:crypto';
import { permittedAddress } from '../../dist/authentication/oidc-network.js';
const execute=promisify(execFile);
export async function discoveryProvider(){
  const address=Object.values(networkInterfaces()).flat().find(value=>value?.family==='IPv4'&&!value.internal&&permittedAddress(value.address,true))?.address;
  if(!address)throw new Error('A non-loopback interface is required for the controlled OIDC provider');
  const directory=await mkdtemp(path.join(tmpdir(),'oidc-discovery-'));
  let server;
  try{
    await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1','-subj','/CN=idp.test','-addext',`subjectAltName=DNS:idp.test,IP:${address}`]);
    const publicKeys=['key-current','key-next'].map(kid=>({...generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({format:'jwk'}),kid,use:'sig',alg:'RS256'}));
    const fixture={origin:'',certificate:path.join(directory,'cert.pem'),metadataOverrides:{},keys:publicKeys};
    server=createServer({key:await readFile(path.join(directory,'key.pem')),cert:await readFile(path.join(directory,'cert.pem'))},(req,res)=>{
      res.setHeader('content-type','application/json');
      if(req.url==='/adfs/.well-known/openid-configuration')res.end(JSON.stringify({issuer:`${fixture.origin}/adfs`,authorization_endpoint:`${fixture.origin}/authorize`,token_endpoint:`${fixture.origin}/token`,jwks_uri:`${fixture.origin}/jwks`,userinfo_endpoint:`${fixture.origin}/userinfo`,end_session_endpoint:`${fixture.origin}/logout`,response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256'],...fixture.metadataOverrides}));
      else if(req.url==='/jwks')res.end(JSON.stringify({keys:fixture.keys}));else res.writeHead(404).end('{}');
    });server.listen(0,address);await once(server,'listening');fixture.origin=`https://${address}:${server.address().port}`;
    fixture.close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});};
    return fixture;
  }catch(error){if(server){server.closeAllConnections();server.close();}await rm(directory,{recursive:true,force:true});throw error;}
}
