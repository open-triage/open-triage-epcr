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
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(?:p|h[1-6])\s*>/gi, '\n\n')
    .replace(/<\/(?:div|tr|li)\s*>|<br\s*\/?>/gi, '\n')
    .replace(/<\/th\s*>\s*<td\b[^>]*>/gi, ': ')
    .replace(/<\/(?:td|th)\s*>\s*<(?:td|th)\b[^>]*>/gi, ' | ')
    .replace(/<img\b[^>]*\balt=(["'])(.*?)\1[^>]*>/gi, ' $2 ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#(x[0-9a-f]+|[0-9]+);/gi, (source, code: string) => {
      const n = code[0]?.toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : source;
    }).replace(/&(amp|lt|gt|quot|apos|nbsp);/g, (_, name: string) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '}[name] ?? ''))
    .replace(/[ \t]+/g, ' ').replace(/[ \t]*\n[ \t]*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
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
/** Display-only clinical text. Only source-authored labels and values are shown;
 * metadata, raw references and unknown extensions stay in the lossless projection.
 * An empty result means the caller should show its localized unavailable label. */
export function clinicalResourceText(resource:Resource, medication?:Resource):string {
  const narrative=text(object(resource.text)?.div);
  if(narrative)return narrativeText(narrative);
  const concept=(value:unknown):string=>{const item=object(value);return text(item?.text)||list(item?.coding).map(c=>text(object(c)?.display)).filter(Boolean).join('; ');};
  const qualifier=(value:unknown):string=>concept(value)||text(value)||list(object(value)?.coding).map(c=>text(object(c)?.code)).filter(Boolean).join('; ');
  const quantity=(value:unknown):string=>{const item=object(value);return typeof item?.value==='number'&&Number.isFinite(item.value)?[text(item.comparator),String(item.value),text(item.unit)].filter(Boolean).join(' '):'';};
  const period=(value:unknown):string=>{const item=object(value);return [text(item?.start),text(item?.end)].filter(Boolean).join(' – ');};
  const value=(item:Resource):string=>text(item.valueString)||concept(item.valueCodeableConcept)||quantity(item.valueQuantity)||text(item.valueDateTime)||text(item.valueTime)||(typeof item.valueInteger==='number'?String(item.valueInteger):'')||(typeof item.valueBoolean==='boolean'?String(item.valueBoolean):'');
  const lines=[text(resource.title),concept(resource.code??resource.vaccineCode),concept(resource.medicationCodeableConcept)||text(object(resource.medicationReference)?.display)||concept(medication?.code),value(resource),text(resource.description)];
  // Status and absence qualifiers must accompany the clinical label: a refuted
  // allergy or resolved condition must never become a positive assertion.
  for(const key of ['clinicalStatus','verificationStatus','status','statusReason','dataAbsentReason'])lines.push(qualifier(resource[key]));
  for(const key of ['interpretation','reasonNotTaken'])for(const item of list(resource[key]))lines.push(qualifier(item));
  for(const component of list(resource.component)){const item=object(component);if(item)lines.push([concept(item.code),value(item),qualifier(item.dataAbsentReason),...list(item.interpretation).map(qualifier)].filter(Boolean).join(': '));}
  for(const annotation of list(resource.note))lines.push(text(object(annotation)?.text));
  for(const dosage of list(resource.dosage))lines.push(text(object(dosage)?.text));
  for(const activity of list(resource.activity))lines.push(text(object(object(activity)?.detail)?.description));
  // Preserve explicitly recorded dates without assigning inferred chronology.
  for(const key of ['occurrenceDateTime','effectiveDateTime','onsetDateTime','performedDateTime','recordedDate','dateAsserted'])lines.push(text(resource[key]));
  for(const key of ['effectivePeriod','onsetPeriod','performedPeriod'])lines.push(period(resource[key]));
  return [...new Set(lines.filter(line=>line.trim()))].join('\n\n');
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
      return div ? narrativeText(div) : clinicalResourceText(resource,index.get(text(object(resource.medicationReference)?.reference)));
    }).join('\n\n');
    const sectionEntries=list(section.entry).map(entry=>{
      const reference=text(object(entry)?.reference),resource=index.get(reference);
      if(!resource)return {identity:reference,label:reference,content:reference};
      const identity=entries.find(e=>e.resource===resource)?.fullUrl||`${resource.resourceType}/${resource.id}`;
      const code=object(resource.code??resource.vaccineCode??resource.medicationCodeableConcept);
      const label=text(code?.text)||list(code?.coding).map(c=>text(object(c)?.display)||text(object(c)?.code)).filter(Boolean).join('; ')||text(resource.title)||text(resource.resourceType);
      return {identity,label,content:clinicalResourceText(resource,index.get(text(object(resource.medicationReference)?.reference)))};
    });
    const structured=narrativeTables(narrative);
    // Match only explicit source evidence, never row order, fuzzy similarity or
    // elimination of a previously matched entry. Ambiguity keeps source details.
    const normalize=(value:string)=>value.normalize('NFC').replace(/\s+/g,' ').trim().toLocaleLowerCase('und');
    const primaryHeaders:Record<string,string[]>={Condition:['condition'],AllergyIntolerance:['allergy','allergen'],Procedure:['procedure'],Flag:['alert'],DeviceUseStatement:['device'],MedicationStatement:['medication'],MedicationAdministration:['medication'],Immunization:['vaccine']};
    const candidates=sectionEntries.map(entry=>{
      const resource=index.get(entry.identity);
      const medication=index.get(text(object(resource?.medicationReference)?.reference));
      const device=index.get(text(object(resource?.device)?.reference));
      const concepts=[resource?.code,resource?.vaccineCode,resource?.medicationCodeableConcept,medication?.code,device?.type].map(object);
      const labels=[text(resource?.title),text(object(resource?.device)?.display),text(object(resource?.medicationReference)?.display),...concepts.flatMap(code=>[text(code?.text),...list(code?.coding).map(c=>text(object(c)?.display))])].filter(Boolean);
      // Only a first, explicitly labeled clinical identity cell is an alias.
      // Arbitrary note/description text cannot identify a different resource.
      const ownNarrative=text(object(resource?.text)?.div);
      const firstRowBody=/<tr\b[^>]*>([^]*?)<\/tr\s*>/i.exec(ownNarrative)?.[1]??'';
      const firstRow=/^\s*<th\b[^>]*>([^]*?)<\/th\s*>\s*<td\b[^>]*>([^]*?)<\/td\s*>\s*$/i.exec(firstRowBody);
      if(firstRow&&(primaryHeaders[text(resource?.resourceType)]??[]).includes(normalize(narrativeText(firstRow[1]!))))labels.push(narrativeText(firstRow[2]!));
      const facts=[...['performedDateTime','effectiveDateTime','occurrenceDateTime'].map(key=>text(resource?.[key])),...['performedPeriod','effectivePeriod','timingPeriod'].flatMap(key=>[text(object(resource?.[key])?.start),text(object(resource?.[key])?.end)]),...list(resource?.dosage).map(d=>text(object(d)?.text)),text(object(resource?.dosage)?.text)].filter(Boolean).map(normalize);
      const urls=resource?.resourceType==='DocumentReference'?list(resource.content).map(item=>text(object(object(item)?.attachment)?.url)).filter(Boolean):[];
      return {identity:entry.identity,labels:labels.map(normalize),facts,urls};
    });
    for(const table of structured.tables)for(const row of table.rows){
      const label=normalize(row.cells[0]??'');if(!label)continue;
      const urlMatches=candidates.filter(candidate=>candidate.urls.some(url=>row.cells.some(cell=>cell.trim()===url)));
      const labelMatches=candidates.filter(candidate=>candidate.labels.includes(label));
      // A supporting document URL must not override a different clinical label.
      let matches=urlMatches.length?[...new Set([...urlMatches,...labelMatches])]:labelMatches;
      if(matches.length>1&&!urlMatches.length){const cells=row.cells.slice(1).map(normalize).filter(Boolean);matches=matches.filter(candidate=>candidate.facts.some(fact=>cells.includes(fact)));}
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
