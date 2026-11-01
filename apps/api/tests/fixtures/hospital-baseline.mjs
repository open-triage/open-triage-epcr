import assert from 'node:assert/strict';
import {SYNTHETIC_DEMO_FIXTURE} from '@open-triage/contracts';
/** Earlier suites may leave other agencies/forms. Hospital journeys use the
 * ordinary seeded demo account, so never choose a form by physical row order. */
export async function hospitalFixtureBaseline(query){
 const [baseline]=await query(`select d.organization_id,v.catalog_release_id
  from forms.agency_stationary_default d join forms.form_version v on v.id=d.form_version_id
  where d.organization_id=$1`,[SYNTHETIC_DEMO_FIXTURE.organizationId]);
 assert.ok(baseline,'Full preflight must seed the ordinary published demonstration form');
 return baseline;
}
