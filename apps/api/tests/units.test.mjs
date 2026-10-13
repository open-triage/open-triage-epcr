import assert from "node:assert/strict";
import test from "node:test";
import { UnitsService, validateUnit } from "../dist/admin/units.service.js";

const unit = { id:"30000000-0000-4000-8000-000000000010",organizationId:"agency",name:"Medic",callSign:"M1",active:true,revision:1 };
function fixture({ rows=[unit], fail }={}) {
  const queries=[];
  const manager={ query:async (sql,params) => {
    queries.push({sql,params});
    if (sql.includes("select")) return rows;
    if (sql.includes("insert into app_identity.operational_unit_event")) return [];
    if (fail) throw fail;
    return [{...unit,revision:2}];
  }};
  const sessions={ requireCapability:async (_token, capability) => {
    queries.push({capability}); return {organization:{id:"agency"},user:{id:"actor"}};
  }};
  return {service:new UnitsService({...manager,transaction:async work=>work(manager)},sessions),queries};
}
test("strict unit input excludes forged agency, IDs, configuration and invalid revisions",()=>{
  const input={name:" Medic ",callSign:" M1 ",active:true};
  assert.deepEqual(validateUnit(input,false),{name:"Medic",callSign:"M1",active:true});
  for (const extra of [{organizationId:"other"},{id:unit.id},{defaultFormId:"override"},{expectedRevision:1}]) {
    assert.throws(()=>validateUnit({...input,...extra},false));
  }
  for (const extra of [{expectedRevision:0},{expectedRevision:1.5},{active:"true"},{name:"\n"},{callSign:"a\tb"}]) {
    assert.throws(()=>validateUnit({...input,expectedRevision:1,...extra},true));
  }
});
test("bounded directory requires agency read authority and validates cursor",async()=>{
  const {service,queries}=fixture({rows:Array.from({length:51},()=>unit)});
  const page=await service.list("token");
  assert.equal(page.items.length,50);assert.equal(page.nextCursor,unit.id);
  assert.equal(queries[0].capability,"settings:read");
  assert.match(queries[1].sql,/organization_id=\$1/);
  await assert.rejects(service.list("token","forged"));
});
test("forged unit ID and stale revision cannot mutate or audit another agency",async()=>{
  for (const [rows,revision] of [[[],1],[[unit],2]]) {
    const {service,queries}=fixture({rows});
    await assert.rejects(service.save("token",unit.id,{name:"Medic",callSign:"M1",active:false,expectedRevision:revision}));
    assert.equal(queries[0].capability,"settings:write");
    assert.match(queries[1].sql,/organization_id=\$1 and id=\$2 for update/);
    assert.equal(queries.length,2);
  }
});
test("deactivation updates only mutable fields and audits in the same transaction",async()=>{
  const {service,queries}=fixture();
  await service.save("token",unit.id,{name:"Replacement",callSign:"M2",active:false,expectedRevision:1});
  const write=queries.find(query=>query.sql?.startsWith("update"));
  assert.match(write.sql,/where organization_id=\$1 and id=\$2/);
  assert.doesNotMatch(write.sql,/default_form_id|clinical\.|delete/i);
  assert.deepEqual(write.params,["agency",unit.id,"Replacement","M2",false]);
  assert.ok(queries.some(query=>query.sql?.includes("operational_unit_event")));
});
test("duplicate call signs produce a useful conflict",async()=>{
  const {service}=fixture({fail:{code:"23505"}});
  await assert.rejects(service.save("token",null,{name:"Medic",callSign:"M1",active:true}),/call sign is already assigned/);
});
