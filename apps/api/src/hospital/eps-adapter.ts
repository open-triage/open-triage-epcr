import { hospitalIdentifiersMatch, parsePatientSummary, type HospitalIdentifier } from '@open-triage/contracts';
import { providerFetch } from '../authentication/oidc-network.js';
import { EPS_ENDPOINT } from './hospital-mapping.js';
type Json = Record<string, unknown>;
const obj = (value: unknown): Json => {if(!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('eps.malformed'); return value as Json;};
/** Listings are adapter-specific. Never follow remote URLs, paging links or references. */
export class EpsAdapter {
  async read(path: string): Promise<unknown> {
    const response = await providerFetch(`${EPS_ENDPOINT}${path}`, undefined, undefined, undefined, 'application/fhir+json');
    return response.json();
  }
  async discover(configuration: HospitalIdentifier, identifier: {system:string;value:string}) {
    const paths = new Set<string>();
    const deadline=Date.now()+20000;
    for (const listing of ['$samples', '$exchange']) {
      const body = obj(await this.read(`/${listing}`));
      if(body.resourceType !== 'Parameters' || !Array.isArray(body.parameter)) throw new Error('eps.malformed');
      for(const entry of body.parameter.map(obj).filter(e=>e.name==='entry')) {
        if(!Array.isArray(entry.part)) throw new Error('eps.malformed');
        const parts = new Map(entry.part.map(obj).map(p=>[String(p.name),p.valueString]));
        if(listing==='$samples') {
          const id = parts.get('id');
          if(typeof id!=='string'||!/^[-A-Za-z0-9]{1,80}$/.test(id)) throw new Error('eps.malformed');
          paths.add(`/Bundle/${id}`);
        } else {
          const slug = parts.get('organizationSlug');
          if(typeof slug!=='string'||!/^[-A-Za-z0-9]{1,80}$/.test(slug)) throw new Error('eps.malformed');
          paths.add(`/Organization/${slug}/$document`);
        }
      }
    }
    if(paths.size>100) throw new Error('eps.limit');
    const matches: {summary:ReturnType<typeof parsePatientSummary>['summary'];documentId:string}[]=[];
    // Bounded concurrency; failures abort the lookup rather than becoming no-match.
    const pending=[...paths];
    let failed=false;
    const outcomes=await Promise.allSettled(Array.from({length:Math.min(4,pending.length)},async()=>{
      while(pending.length&&!failed) {
        try {
        if(Date.now()>deadline)throw new Error('eps.timeout');
        const path=pending.shift()!;
        const parsed=parsePatientSummary(await this.read(path));
        if(parsed.identifiers.some(remote=>hospitalIdentifiersMatch(configuration,identifier,remote)))matches.push({summary:parsed.summary,documentId:path});
        }catch(error){failed=true;throw error;}
      }
    }));
    if(outcomes.some(outcome=>outcome.status==='rejected'))throw new Error('eps.failed');
    return matches.sort((a,b)=>Date.parse(b.summary.date!)-Date.parse(a.summary.date!)||a.documentId.localeCompare(b.documentId))[0]??null;
  }
}
