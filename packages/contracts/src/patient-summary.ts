/** Read-only, lossless display projection. Source strings are text, never HTML or URLs to fetch. */
export type SummaryRow = { path: string; value: string };
export type SummarySection = { title: string; rows: SummaryRow[] };
export type NarrativeTable = { headers: string[]; rows: { cells: string[]; identity?: string }[] };
export type ClinicalSummaryEntry = { identity: string; label: string; content: string };
export type PatientSummary = {
  title: string; patient: string; date: string | null; source: string; authors: string[];
  importEntries?: {identity:string; patientMatches:boolean; resource:Record<string,unknown>; medication?:Record<string,unknown>}[];
  documentVersion?: string;
  sections: SummarySection[]; clinicalSections: {title:string; content:string; entries?:ClinicalSummaryEntry[]; tables?:NarrativeTable[]; prose?:string}[]; findings: string[];
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
/** Extract only simple rectangular XHTML tables into inert strings. Unsupported
 * structures remain in prose; no source markup or attributes reach the browser. */
export function narrativeTables(value: string): {tables:NarrativeTable[];prose:string} {
  const tables:NarrativeTable[]=[];
  const safe=value.replace(/<!--[^]*?-->/g,'').replace(/<(script|style)\b[^>]*>[^]*?<\/\1>/gi,'');
  const remainder=safe.replace(/<table\b[^>]*>([^]*?)<\/table\s*>/gi,(whole:string,body:string)=>{
    if(/<table\b|\b(?:rowspan|colspan)\s*=/i.test(body))return whole;
    const rows=[...body.matchAll(/<tr\b[^>]*>([^]*?)<\/tr\s*>/gi)].map(row=>{
      const cells=[...row[1]!.matchAll(/<(th|td)\b[^>]*>([^]*?)<\/\1\s*>/gi)];
      return {header:cells.length>0&&cells.every(cell=>cell[1]!.toLowerCase()==='th'),cells:cells.map(cell=>narrativeText(cell[2]!))};
    });
    if(!rows.length||!rows[0]!.header||rows.some(row=>row.cells.length!==rows[0]!.cells.length))return whole;
    tables.push({headers:rows[0]!.cells,rows:rows.slice(1).map(row=>({cells:row.cells}))});
    return [...body.matchAll(/<caption\b[^>]*>([^]*?)<\/caption\s*>/gi)].map(caption=>caption[1]).join(' ');
  });
  return {tables,prose:narrativeText(remainder)};
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
  const clinicalSections: PatientSummary['clinicalSections']=[];
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
    const sectionEntries=list(section.entry).map(entry=>{
      const reference=text(object(entry)?.reference),resource=index.get(reference);
      if(!resource)return {identity:reference,label:reference,content:reference};
      const identity=entries.find(e=>e.resource===resource)?.fullUrl||`${resource.resourceType}/${resource.id}`;
      const code=object(resource.code??resource.medicationCodeableConcept);
      const label=text(code?.text)||list(code?.coding).map(c=>text(object(c)?.display)||text(object(c)?.code)).filter(Boolean).join('; ')||text(resource.title)||text(resource.resourceType);
      const narrative=text(object(resource.text)?.div);
      return {identity,label,content:narrative?narrativeText(narrative):rows(resource).map(row=>`${row.path}: ${row.value}`).join('\n')};
    });
    const structured=narrativeTables(narrative);
    // Never associate clinical actions by row order: narratives may omit entries,
    // reorder them, or include additional text-only records. Require a unique
    // exact source label in the first cell and a unique row for that identity.
    const candidates=sectionEntries.map(entry=>{
      const resource=index.get(entry.identity);
      const medication=index.get(text(object(resource?.medicationReference)?.reference));
      const concepts=[resource?.code,resource?.medicationCodeableConcept,medication?.code].map(object);
      const labels=[text(object(resource?.medicationReference)?.display),...concepts.flatMap(code=>[text(code?.text),...list(code?.coding).map(c=>text(object(c)?.display))])].filter(Boolean);
      return {identity:entry.identity,labels};
    });
    for(const table of structured.tables)for(const row of table.rows){
      const matches=candidates.filter(candidate=>candidate.labels.includes(row.cells[0]??''));
      if(matches.length===1)row.identity=matches[0]!.identity;
    }
    const identities=structured.tables.flatMap(table=>table.rows.map(row=>row.identity).filter(Boolean));
    for(const table of structured.tables)for(const row of table.rows){
      if(row.identity&&identities.filter(id=>id===row.identity).length!==1)delete row.identity;
    }
    clinicalSections.push({title:text(section.title)||text(object(section.code)?.text),content,entries:sectionEntries,...structured});
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
    documentVersion: text(object(bundle.meta)?.versionId)||text(object(composition.meta)?.versionId)||text(bundle.id), importEntries: entries.filter(e=>['AllergyIntolerance','Condition','MedicationStatement','Observation','Procedure','Patient'].includes(String(e.resource.resourceType))).map(e=>({identity:e.fullUrl||`${e.resource.resourceType}/${e.resource.id}`,patientMatches:e.resource===subject||index.get(text(object(e.resource.patient??e.resource.subject)?.reference))===subject,resource:e.resource,...(e.resource.resourceType==='MedicationStatement'&&index.get(text(object(e.resource.medicationReference)?.reference))?.resourceType==='Medication'?{medication:index.get(text(object(e.resource.medicationReference)?.reference))}: {})})), source: label(composition.custodian), authors: list(composition.author).map(reference=>label(reference)), sections, clinicalSections, findings: [...findings]} };
}
export type EpsContext = { reportId: string; organizationId: string; binding: string; configurationRevision: number; mappingId: string; mappingRevision: number; mappingSha256: string; patientIdentifier: import('./hospital-integration.js').HospitalIdentifier };
export type EpsLookup = { context: EpsContext | null; status: 'disabled' | 'missing' | 'available' | 'no-match'; summary?: PatientSummary; retrievedAt?: string; documentId?: string; documentSha256?: string };
