import test from 'node:test';import assert from 'node:assert/strict';
import {historyAcknowledgement,historyFinding} from '../dist/hospital/hospital-history.service.js';
test('operational evidence allowlists typed acknowledgements without arbitrary provider data',()=>{
 assert.deepEqual(historyAcknowledgement({receiptId:'not-a-receipt-secret',payloadSha256:'a'.repeat(64),pdfSha256:'clinical-story',headers:{'x-pass':'true','x-errors':'0','authorization':'secret','content-location':'https://example.invalid/patient'},issues:[{diagnostics:'patient'}]}),{payloadSha256:'a'.repeat(64),pass:true,errors:0});
 assert.equal(historyFinding('secret patient diagnostic'),null);assert.equal(historyFinding('outage'),'outage');
});
