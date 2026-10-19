/** Read-only, lossless display projection. Source strings are text, never HTML or URLs to fetch. */
export type SummaryRow = { path: string; value: string };
export type SummarySection = { title: string; rows: SummaryRow[] };
export type PatientSummary = {
  title: string; patient: string; date: string | null; source: string; authors: string[];
  importEntries?: {identity:string; patientMatches:boolean; resource:Record<string,unknown>; medication?:Record<string,unknown>}[];
  documentVersion?: string;
  sections: SummarySection[]; clinicalSections: {title:string; content:string}[]; findings: string[];
};
type Resource = Record<string, unknown>;
const object = (value: unknown): Resource | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Resource : null;
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
/** XHTML is reduced to inert display text. React still escapes the result. */
export function narrativeText(value: string): string {
  return value.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(?:p|div|tr|li|h[1-6])\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<img\b[^>]*\balt=(["'])(.*?)\1[^>]*>/gi, ' $2 ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (source, code: string) => {
      const n = code[0]?.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : source;
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[name] ?? ''))
    .replace(/[ \t]+/g, ' ').trim();
}
export function parsePatientSummary(input: unknown): { summary: PatientSummary; identifiers: { system: string; value: string }[] } {
  const bundle = object(input);
  if (!bundle || bundle.resourceType !== 'Bundle' || bundle.type !== 'document' || !Array.isArray(bundle.entry) || !bundle.entry.length || bundle.entry.length > 2000) throw new Error('eps.malformed');
  const entries = bundle.entry.map(entry => {
    const e = object(entry), resource = object(e?.resource);
    if (!resource || !text(resource.resourceType)) throw new Error('eps.malformed');
    return { fullUrl: text(e?.fullUrl), resource, metadata: Object.fromEntries(Object.entries(e!).filter(([key])=>key!=='resource')) };
  });
  const composition = entries[0]!.resource;
  if (composition.resourceType !== 'Composition' || !object(composition.type) || !text(composition.status) || !Number.isFinite(Date.parse(text(composition.date)))) throw new Error('eps.malformed');
  const index = new Map<string, Resource>();
  for (const {fullUrl, resource} of entries) {
    for (const key of new Set([fullUrl, resource.id ? `${resource.resourceType}/${resource.id}` : ''].filter(Boolean))) {
      if (index.has(key)) throw new Error('eps.malformed');
      index.set(key, resource);
    }
  }
  const subject = index.get(text(object(composition.subject)?.reference));
  if (!subject || subject.resourceType !== 'Patient') throw new Error('eps.malformed');
  // A document with additional patient identities cannot safely be attributed to one patient.
  if (entries.some(e => e.resource.resourceType === 'Patient' && e.resource !== subject)) throw new Error('eps.malformed');
  const identifiers = list(subject.identifier).flatMap(id => {
    const value = object(id); return text(value?.system) && text(value?.value) ? [{system: text(value?.system), value: text(value?.value)}] : [];
  });
  if(!identifiers.length)throw new Error('eps.malformed');
  const findings = new Set<string>();
  const rows = (resource: unknown): SummaryRow[] => {
    const result: SummaryRow[] = [];
    const walk = (value: unknown, path: string, depth: number) => {
      if (depth > 40) throw new Error('eps.malformed');
      if (Array.isArray(value)) value.forEach((item, i) => walk(item, `${path}[${i+1}]`, depth+1));
      else if (object(value)) Object.entries(value as Resource).forEach(([key, item]) => {
        if(key === 'div' && typeof item === 'string'){
          for(const match of item.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi))findings.add(match[1]!);
        }
        if (key === 'reference' && typeof item === 'string' && !index.has(item)) findings.add(item);
        walk(item, path ? `${path}.${key}` : key, depth+1);
      });
      else if (value !== undefined) result.push({path, value: value === null ? 'null' : path.endsWith('.div') ? narrativeText(String(value)) : String(value)});
    };
    walk(resource, '', 0); return result;
  };
  const label = (reference: unknown, depth=0): string => {
    const ref = object(reference); const resource = index.get(text(ref?.reference));
    if(depth>4)return text(ref?.reference);
    const names=list(resource?.name).map(name=>{const n=object(name);return text(n?.text)||[...list(n?.given).map(text),text(n?.family)].filter(Boolean).join(' ');}).filter(Boolean).join('; ');
    return text(ref?.display) || text(resource?.name) || names || (resource?.practitioner ? label(resource.practitioner,depth+1) : '') || text(ref?.reference);
  };
  const clinicalSections: {title:string;content:string}[]=[];
  const sectionContent=(value:unknown,depth=0)=>{
    if(depth>40)throw new Error('eps.malformed');
    const section=object(value);if(!section)return;
    const narrative=text(object(section.text)?.div);
    const content=narrative ? narrativeText(narrative) : list(section.entry).map(entry=>{
      const resource=index.get(text(object(entry)?.reference));
      if(!resource)return text(object(entry)?.reference);
      const div=text(object(resource.text)?.div);
      return div ? narrativeText(div) : rows(resource).map(row=>`${row.path}: ${row.value}`).join('\n');
    }).join('\n\n');
    clinicalSections.push({title:text(section.title)||text(object(section.code)?.text),content});
    list(section.section).forEach(child=>sectionContent(child,depth+1));
  };
  list(composition.section).forEach(section=>sectionContent(section));
  // Include every resource and leaf, including unsupported extensions, historical
  // dates, devices, care plans and orphan resources. No terminology inference.
  const sections = entries.map(({resource,metadata}) => ({
    title: text(resource.title) || `${resource.resourceType}${resource.id ? ` / ${resource.id}` : ''}`,
    rows: [...rows(metadata),...rows(resource)],
  }));
  sections.push({title:'Bundle',rows:rows(Object.fromEntries(Object.entries(bundle).filter(([key])=>key!=='entry')))});
  return { identifiers, summary: {title: text(composition.title), patient:label(composition.subject), date: text(composition.date) || null,
    documentVersion: text(object(bundle.meta)?.versionId)||text(object(composition.meta)?.versionId)||text(bundle.id), importEntries: entries.filter(e=>['AllergyIntolerance','Condition','MedicationStatement'].includes(String(e.resource.resourceType))).map(e=>({identity:e.fullUrl||`${e.resource.resourceType}/${e.resource.id}`,patientMatches:index.get(text(object(e.resource.patient??e.resource.subject)?.reference))===subject,resource:e.resource,...(e.resource.resourceType==='MedicationStatement'&&index.get(text(object(e.resource.medicationReference)?.reference))?.resourceType==='Medication'?{medication:index.get(text(object(e.resource.medicationReference)?.reference))}: {})})), source: label(composition.custodian), authors: list(composition.author).map(reference=>label(reference)), sections, clinicalSections, findings: [...findings]} };
}
export type EpsContext = { reportId: string; organizationId: string; binding: string; configurationRevision: number; mappingId: string; mappingRevision: number; mappingSha256: string; patientIdentifier: import('./hospital-integration.js').HospitalIdentifier };
export type EpsLookup = { context: EpsContext | null; status: 'disabled' | 'missing' | 'available' | 'no-match'; summary?: PatientSummary; retrievedAt?: string; documentId?: string; documentSha256?: string };
