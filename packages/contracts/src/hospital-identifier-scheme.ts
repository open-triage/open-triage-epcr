/** Published Inera identity formats. Validation preserves the supplied value and
 * never allocates, normalizes, aliases or asserts that an identifier was issued.
 * Sources: https://inera.atlassian.net/wiki/spaces/PU/pages/3353215438/Identitetsformat
 * https://inera.atlassian.net/wiki/spaces/PU/pages/3413475352/4.10+Lokala+Reservidformat */
export const SWEDISH_PATIENT_IDENTIFIER_NAMESPACES = {
 personal: 'urn:oid:1.2.752.129.2.1.3.1',
 carelinkReserve: 'urn:oid:1.2.752.129.2.1.3.2',
 coordination: 'urn:oid:1.2.752.129.2.1.3.3',
} as const;
export function hospitalIdentifierSchemeFinding(namespace: string, value: string): 'unsupported' | 'invalid' | null {
 const schemes = SWEDISH_PATIENT_IDENTIFIER_NAMESPACES;
 if (!Object.values(schemes).some(item => item === namespace)) return 'unsupported';
 if (!/^\d{12}$/.test(value)) return 'invalid';
 const year=Number(value.slice(0,4)),month=Number(value.slice(4,6)),encodedDay=Number(value.slice(6,8));
 if(namespace===schemes.carelinkReserve){
  if(year<1700||year>2099||month<1||month>12||encodedDay<32||encodedDay>59)return 'invalid';
 }else{
  if(year<1800||year>2099||month>12||Number(value.slice(8,11))===0)return 'invalid';
  const day=namespace===schemes.coordination?encodedDay-60:encodedDay;
  if(day<1||day>31)return 'invalid';
  // Inera explicitly permits unknown month 00 and evaluates it as January.
  const date=new Date(Date.UTC(year,Math.max(1,month)-1,day));
  if(date.getUTCFullYear()!==year||date.getUTCMonth()!==Math.max(1,month)-1||date.getUTCDate()!==day)return 'invalid';
 }
 let sum=0;
 for(let index=2;index<12;index++){const product=Number(value[index])*(index%2===0?2:1);sum+=product>9?product-9:product;}
 return sum%10===0?null:'invalid';
}
