/** Fixed route labels and HTTP statuses only: no tokens, URLs, headers or bodies. */
export function enrollmentBoundaryFixture() {
  const receipts={health:{count:0,statuses:[]},current:{count:0,statuses:[]},preview:{count:0,statuses:[]}};
  const routes={'GET /api/health':'health','GET /api/installations/current':'current','POST /api/installations/preview':'preview'};
  return {
    middleware(request,response,next) {
      const key=routes[request.method+' '+request.url.split('?',1)[0]],receipt=receipts[key];
      if(receipt){receipt.count++;response.once('finish',()=>{if(receipt.statuses.length<32)receipt.statuses.push(Number.isInteger(response.statusCode)?response.statusCode:0);});}
      return next();
    },
    snapshot:()=>Object.fromEntries(Object.entries(receipts).map(([key,value])=>[key,{count:value.count,statuses:[...value.statuses]}])),
  };
}
