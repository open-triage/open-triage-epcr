'use client';
import {useEffect,useRef,useState, type ReactNode, type HTMLAttributes} from 'react';
import {activateListRow} from './list-row-action';
import { type EpsImportRow, type PatientSummary } from '@open-triage/contracts';
import { resolveMessage } from '../app/localization';

export function EpsSectionTables({summary,language,rows=[],action=()=>null}:{summary:PatientSummary;language:string;rows?:EpsImportRow[];action?:(row:EpsImportRow)=>ReactNode}) {
 const [detail,setDetail]=useState<{title:string;content:string;identity?:string}|null>(null);
 const dialog=useRef<HTMLDialogElement>(null);
 const trigger=useRef<HTMLTableRowElement|null>(null);
 useEffect(()=>{if(detail)dialog.current?.showModal();},[detail]);
 const t=(key:string)=>resolveMessage(language,key);
 const mapped=new Map(rows.map(row=>[row.entryId,row]));
 const referenced=new Set(summary.clinicalSections.flatMap(section=>section.entries?.map(entry=>entry.identity)??[]));
 const other=rows.filter(row=>!referenced.has(row.entryId));
 const sourceContent=(id:string)=>{const resource=summary.importEntries?.find(entry=>entry.identity===id)?.resource;return resource?JSON.stringify(resource,null,2):'';};
 const sections:PatientSummary['clinicalSections']=[...summary.clinicalSections,...(other.length?[{title:t('eps.otherEntries'),content:'',entries:other.map(row=>({identity:row.entryId,label:row.label,content:sourceContent(row.entryId)}))}]:[])];
 const detailRow=(title:string,content:string,identity?:string):HTMLAttributes<HTMLTableRowElement>=>{
  const open=(row:HTMLTableRowElement)=>{trigger.current=row;setDetail({title,content,identity});};
  return {tabIndex:0,'aria-label':`${t('eps.details')}: ${title}`,
   onClick:event=>activateListRow(event,()=>open(event.currentTarget)),
   onKeyDown:event=>{if(event.target===event.currentTarget&&(event.key==='Enter'||event.key===' ')){event.preventDefault();open(event.currentTarget);}}
  };
 };
 return <>{sections.map((section,index)=>{
 const linked=new Set(section.tables?.flatMap(table=>table.rows.map(row=>row.identity))??[]);
 const extra=section.entries?.filter(entry=>!linked.has(entry.identity));
 const entriesTable=<table><caption>{section.title||t('eps.section')}</caption><thead><tr><th scope="col">{t('epsImport.item')}</th><th scope="col">{t('eps.content')}</th><th scope="col">{t('epsImport.destination')}</th><th scope="col">{t('epsImport.action')}</th></tr></thead><tbody>
 {(section.tables?.length?extra:section.entries)?.map((entry,i)=>{const row=mapped.get(entry.identity);return <tr key={i} {...detailRow(entry.label,entry.content,entry.identity)}><th scope="row">{entry.label}</th><td data-label={t('eps.content')}>{entry.content}</td><td data-label={t('epsImport.destination')}>{row?.destination??t('epsImport.unmapped')}</td><td data-label={t('epsImport.action')}>{row?action(row):null}</td></tr>;})}
 {!section.entries?.length&&<tr {...detailRow(section.title,section.content||t('eps.unknown'))}><td colSpan={4}>{section.content||t('eps.unknown')}</td></tr>}
 </tbody></table>;
 return <section className="eps-clinical-section" key={index}>
 {section.tables?.length?<>
 {section.prose&&<p className="eps-section-narrative">{section.prose}</p>}
 {section.tables.map((table,tableIndex)=>{

 return <table key={tableIndex}><caption>{section.title||t('eps.section')}</caption><thead><tr>{table.headers.map((header,i)=><th scope="col" key={i}>{header}</th>)}<th scope="col">{t('epsImport.action')}</th></tr></thead><tbody>
 {table.rows.map((entry,i)=>{const row=entry.identity?mapped.get(entry.identity):undefined;return <tr key={i} {...detailRow(entry.cells[0]||section.title,[...entry.cells.map((cell,j)=>`${table.headers[j]}: ${cell}`),section.entries?.find(item=>item.identity===entry.identity)?.content].filter(Boolean).join('\n'),entry.identity)}>{entry.cells.map((cell,j)=>j===0?<th scope="row" key={j}>{cell}</th>:<td key={j} data-label={table.headers[j]}>{cell}</td>)}<td data-label={t('epsImport.action')}>{row?action(row):null}</td></tr>;})}
 </tbody></table>;
 })}
 {!!extra?.length&&<details><summary>{t('eps.otherEntries')}</summary>{entriesTable}</details>}
 </>:entriesTable}
 </section>;
 })}<dialog ref={dialog} className="eps-dialog eps-entry-dialog" aria-label={detail?.title} onClose={()=>{setDetail(null);trigger.current?.focus();}}><header><h2>{detail?.title}</h2><button type="button" autoFocus onClick={()=>dialog.current?.close()}>{t('eps.close')}</button></header><div className="eps-content"><p className="eps-entry-content">{detail?.content}</p>{detail?.identity&&sourceContent(detail.identity)&&<pre>{sourceContent(detail.identity)}</pre>}</div></dialog></>;
}
