import assert from "node:assert/strict";
import test from "node:test";
import { CsrfGuard } from "../dist/sessions/csrf.guard.js";
import { SESSION_COOKIE } from "../dist/sessions/clinician-session.controller.js";

function context(request) {
  return { switchToHttp: () => ({ getRequest: () => request }) };
}

test("CSRF checks apply only to cookie-authenticated state changes", async () => {
  const proofs = [];
  const guard = new CsrfGuard({ assertCsrf: async (...proof) => { proofs.push(proof); } });

  assert.equal(await guard.canActivate(context({ method: "GET", url: "/api/reports", headers: {} })), true);
  assert.equal(await guard.canActivate(context({ method: "POST", originalUrl: "/api/sessions?next=/", headers: {} })), true);
  assert.equal(await guard.canActivate(context({ method: "PATCH", url: "/api/reports/one", headers: {
    authorization: "Bearer legacy-token",
  } })), true);
  assert.deepEqual(proofs, []);

  assert.equal(await guard.canActivate(context({ method: "DELETE", url: "/api/sessions/current", headers: {
    cookie: `theme=dark; ${SESSION_COOKIE}=cookie-token; other=value`,
    "x-csrf-token": "csrf-proof",
  } })), true);
  assert.deepEqual(proofs, [["cookie-token", "csrf-proof"]]);
});

test("cookie requests do not accept array-valued CSRF headers", async () => {
  let received;
  const guard = new CsrfGuard({ assertCsrf: async (_token, csrf) => { received = csrf; } });
  await guard.canActivate(context({ method: "POST", url: "/api/reports", headers: {
    cookie: `${SESSION_COOKIE}=cookie-token`, "x-csrf-token": ["one", "two"],
  } }));
  assert.equal(received, undefined);
});

test("authentication policy cookie mutations require a valid CSRF proof", async () => {
  const guard = new CsrfGuard({ assertCsrf: async (_token, proof) => { if (proof !== "valid") throw new Error("CSRF denied"); } });
  for (const proof of [undefined, "forged", ["valid"]]) {
    await assert.rejects(guard.canActivate(context({ method: "PUT", url: "/api/admin/authentication", headers: { cookie: `${SESSION_COOKIE}=session`, "x-csrf-token": proof } })), /CSRF denied/);
  }
  assert.equal(await guard.canActivate(context({ method: "PUT", url: "/api/admin/authentication", headers: { cookie: `${SESSION_COOKIE}=session`, "x-csrf-token": "valid" } })), true);
});

test('agency handoff bootstrap requires a non-simple header even without a cookie; source issue keeps CSRF',async()=>{
 const proofs=[];const guard=new CsrfGuard({assertCsrf:async(...args)=>proofs.push(args)});
 for(const stage of ['challenge','consume','challenge?retry=1','consume/?retry=1']){
  const request={method:'POST',url:`/api/sessions/agency-handoff/${stage}`,headers:{}};
  await assert.rejects(guard.canActivate(context(request)));
  request.headers['x-agency-handoff']='1';assert.equal(await guard.canActivate(context(request)),true);
 }
 for(const stage of ['start','issue'])await guard.canActivate(context({method:'POST',url:`/api/sessions/agency-handoff/${stage}`,headers:{cookie:`${SESSION_COOKIE}=source-session`,'x-agency-handoff':'1','x-csrf-token':'source-csrf'}}));
 assert.deepEqual(proofs,[['source-session','source-csrf'],['source-session','source-csrf']]);
});

test('SSO unlink requires a valid cookie CSRF proof',async()=>{
 const guard=new CsrfGuard({assertCsrf:async(_token,proof)=>{if(proof!=='valid')throw Error('CSRF denied');}});
 for(const proof of [undefined,'forged',['valid']])await assert.rejects(guard.canActivate(context({method:'POST',url:'/api/admin/users/user/sso/unlink',headers:{cookie:`${SESSION_COOKIE}=session`,'x-csrf-token':proof}})),/CSRF denied/);
 assert.equal(await guard.canActivate(context({method:'POST',url:'/api/admin/users/user/sso/unlink',headers:{cookie:`${SESSION_COOKIE}=session`,'x-csrf-token':'valid'}})),true);
});
