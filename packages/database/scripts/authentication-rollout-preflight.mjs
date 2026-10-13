import pg from 'pg';
import { pathToFileURL } from 'node:url';

/** Read-only inventory works before the group policy migration can run. */
export async function authenticationRolloutPreflight(client) {
  const {rows:members}=await client.query(`select coalesce(a.parent_organization_id,a.id) as group_id,
    a.id,a.name,a.shift_session_duration_hours,
    coalesce(s.authentication_account_attempt_limit,20) as account_attempt_limit,
    coalesce(s.authentication_network_attempt_limit,60) as network_attempt_limit
    from app_identity.organization a left join app_identity.agency_settings s on s.organization_id=a.id
    order by group_id,a.id`);
  const {rows:[schema]}=await client.query("select to_regclass('app_identity.group_authentication_policy') is not null as policy_migrated");
  const groups=Map.groupBy(members,member=>member.group_id);
  const conflicts=schema.policy_migrated?[]:[...groups].filter(([,values])=>
    ['shift_session_duration_hours','account_attempt_limit','network_attempt_limit'].some(key=>new Set(values.map(value=>value[key])).size>1))
    .map(([groupId,values])=>({groupId,members:values}));
  return {phase:schema.policy_migrated?'group-policy-migrated':'before-group-policy-migration',conflicts,members,
    ready:conflicts.length===0, nextStep:conflicts.length?'Record explicit administrator decisions and align legacy values before migrating. See docs/runbooks/group-authentication-policy.md.':
      'Apply forward migrations, then inspect Admin > Authentication > Production workflow rollout. Enable explicitly only after preparation and regional acceptance.'};
}

if (process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required for the read-only upgrade preflight');
  const client=new pg.Client({connectionString:process.env.DATABASE_URL});
  try {await client.connect();await client.query('begin read only');
    const result=await authenticationRolloutPreflight(client);console.log(JSON.stringify(result,null,2));
    await client.query('rollback');if(!result.ready)process.exitCode=2;
  } finally {await client.end();}
}
