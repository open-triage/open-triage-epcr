import assert from 'node:assert/strict';

/** UI text alone cannot prove a native authentication result or cookie delivery. */
export function assertNativeAuthenticationOutcome({expected,result,delivered,sessionStatus,userId,expectedUserId}) {
  assert(['pending','failed','succeeded'].includes(expected),'Known native authentication outcome required');
  assert.equal(result,expected,'The exact server outcome must match the requested acceptance case');
  assert.equal(delivered,true,'The native transaction must actually settle before acceptance');
  assert.equal(sessionStatus,expected==='succeeded'?200:401,'Application session authority must match the exact outcome');
  if(expected==='succeeded'){
    assert(expectedUserId,'Approved acceptance requires a specific expected user');
    assert.equal(userId,expectedUserId,'Only the intended approved user may receive the application session');
  }else assert.equal(userId,null,'Pending and failed identities have no application user');
}
