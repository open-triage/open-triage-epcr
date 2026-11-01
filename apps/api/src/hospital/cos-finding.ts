export class CosFinding extends Error {
  constructor(public readonly code:string,public readonly state:'waiting'|'failed'|'excluded'='waiting'){super(code);}
}
