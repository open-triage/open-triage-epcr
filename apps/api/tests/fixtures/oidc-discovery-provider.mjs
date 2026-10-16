import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir,networkInterfaces } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:https';
import { once } from 'node:events';
import { generateKeyPairSync,randomBytes,createHash,sign } from 'node:crypto';
import { permittedAddress } from '../../dist/authentication/oidc-network.js';
const execute=promisify(execFile);
export async function discoveryProvider(){
  const address=Object.values(networkInterfaces()).flat().find(value=>value?.family==='IPv4'&&!value.internal&&permittedAddress(value.address,true))?.address;
  if(!address)throw new Error('A non-loopback interface is required for the controlled OIDC provider');
  const directory=await mkdtemp(path.join(tmpdir(),'oidc-discovery-'));
  let server;
  try{
    await execute('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(directory,'key.pem'),'-out',path.join(directory,'cert.pem'),'-days','1','-subj','/CN=idp.test','-addext',`subjectAltName=DNS:idp.test,IP:${address}`]);
    const pairs=['key-current','key-next'].map(kid=>({kid,...generateKeyPairSync('rsa',{modulusLength:2048})}));
    const publicKeys=pairs.map(pair=>({...pair.publicKey.export({format:'jwk'}),kid:pair.kid,use:'sig',alg:'RS256'}));
    const codes=new Map();
    const fixture={origin:'',certificate:path.join(directory,'cert.pem'),metadataOverrides:{},keys:publicKeys,tokenOverrides:{},tokenKid:'key-current',invalidSignature:false,authorizationCount:0,tokenCount:0,jwksCount:0,clientSecret:'fresh-provider-secret'};
    server=createServer({key:await readFile(path.join(directory,'key.pem')),cert:await readFile(path.join(directory,'cert.pem'))},(req,res)=>{
      res.setHeader('content-type','application/json');
      if(req.url==='/adfs/.well-known/openid-configuration')res.end(JSON.stringify({issuer:`${fixture.origin}/adfs`,authorization_endpoint:`${fixture.origin}/authorize`,token_endpoint:`${fixture.origin}/token`,jwks_uri:`${fixture.origin}/jwks`,userinfo_endpoint:`${fixture.origin}/userinfo`,end_session_endpoint:`${fixture.origin}/logout`,response_types_supported:['code'],subject_types_supported:['public'],id_token_signing_alg_values_supported:['RS256'],token_endpoint_auth_methods_supported:['client_secret_post'],code_challenge_methods_supported:['S256'],...fixture.metadataOverrides}));
      else if(req.url==='/jwks'){fixture.jwksCount++;res.end(JSON.stringify({keys:fixture.keys}));}
      else if(req.url==='/userinfo'){
        fixture.userinfoCount=(fixture.userinfoCount??0)+1;
        if(req.headers.authorization!=='Bearer fictional-access-token'){res.writeHead(401).end('{}');return;}
        res.end(JSON.stringify({sub:'fictional-provider-user',name:'Alice Smith',email:'alice@example.test',...fixture.userinfoOverrides}));
      }
      else if(req.url.startsWith('/authorize?')){
        fixture.authorizationCount++;const params=new URL(req.url,fixture.origin).searchParams;
        if(fixture.browserLogin&&!params.has('confirm')){const next=new URL(req.url,fixture.origin);next.searchParams.set('confirm','1');res.setHeader('content-type','text/html');res.end(`<a href="${next.href.replaceAll('&','&amp;')}">Continue fictional provider login</a>`);return;}
        const code=randomBytes(24).toString('base64url');codes.set(code,params);
        const callback=new URL(params.get('redirect_uri'));callback.searchParams.set('code',code);callback.searchParams.set('state',params.get('state'));res.writeHead(302,{location:callback.href}).end();
      }else if(req.url==='/token'&&req.method==='POST'){
        if(fixture.personalProofMode==='outage'){res.writeHead(503).end('{}');return;}
        fixture.tokenCount++;let body='';req.on('data',part=>body+=part);req.on('end',async()=>{
          await fixture.beforeToken?.();
          const params=new URLSearchParams(body),authorization=codes.get(params.get('code'));codes.delete(params.get('code'));
          if(!authorization||params.get('client_secret')!==fixture.clientSecret||params.get('client_id')!==authorization.get('client_id')||params.get('redirect_uri')!==authorization.get('redirect_uri')||authorization.get('code_challenge')!==createHash('sha256').update(params.get('code_verifier')||'').digest('base64url')){res.writeHead(400).end('{}');return;}
          const pair=pairs.find(pair=>pair.kid===fixture.tokenKid);const now=Math.floor(Date.now()/1000);
          const personal=fixture.personalProofMode ? {acr:'fixture:interactive-personal',amr:['fixture-personal'],auth_time:now} : {};
          if(fixture.personalProofMode==='cached')personal.auth_time=now-600;
          if(fixture.personalProofMode==='silent')personal.amr=['sso'];
          if(fixture.personalProofMode==='method')personal.acr='fixture:unapproved-method';
          if(fixture.personalProofMode==='future')personal.auth_time=now+1;
          const claims={iss:`${fixture.origin}/adfs`,sub:'fictional-provider-user',aud:params.get('client_id'),iat:now,exp:now+300,nonce:authorization.get('nonce'),...personal,...fixture.tokenOverrides};
          const payload=[{alg:'RS256',kid:pair.kid,...fixture.headerOverrides},claims].map(value=>Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
          const signature=fixture.invalidSignature?randomBytes(256):sign('RSA-SHA256',Buffer.from(payload),pair.privateKey);
          res.end(JSON.stringify({access_token:'fictional-access-token',token_type:'Bearer',expires_in:300,id_token:`${payload}.${signature.toString('base64url')}`}));
        });
      }else res.writeHead(404).end('{}');
    });server.listen(0,address);await once(server,'listening');fixture.origin=`https://${address}:${server.address().port}`;
    fixture.close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(directory,{recursive:true,force:true});};
    return fixture;
  }catch(error){if(server){server.closeAllConnections();server.close();}await rm(directory,{recursive:true,force:true});throw error;}
}
