// Synthetic launcher only: bounded, report-scoped one-shot failure and receipts.
export function pdfDownloadFixture() {
  const reports = new Map();
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  return (request, response, next) => {
    const url = new URL(request.url, 'https://synthetic.invalid');
    if (url.pathname === '/api/__android-pdf-download-fail' && ['POST','GET'].includes(request.method)) {
      const id = url.searchParams.get('reportId');
      if (!uuid.test(id ?? '') || url.searchParams.size !== 1) return response.status(400).json({ error: 'invalid fixture report' });
      if (request.method === 'POST') {
        if (!reports.has(id) && reports.size >= 4) return response.status(503).json({ armed: false });
        reports.set(id, { armed: true, requests: 0, failures: 0, statuses: [] });
      }
      const state = reports.get(id);
      return state ? response.json({ ...state, statuses: [...state.statuses] }) : response.status(404).json({ armed: false });
    }
    const match = /^\/api\/review\/reports\/([a-f0-9-]{36})\/snapshots\/[a-f0-9-]{36}\/pdf$/.exec(url.pathname);
    const state = request.method === 'GET' && match ? reports.get(match[1]) : null;
    if (!state) return next();
    state.requests++;
    response.once('finish', () => { if (state.statuses.length < 8) state.statuses.push(response.statusCode); });
    if (state.armed) {
      state.armed = false; state.failures++;
      return response.status(503).set('Cache-Control', 'no-store').json({ code: 'fixture.download-unavailable' });
    }
    return next();
  };
}

/** Keep media failure armed until both the server receipt and failed client state are observed. */
export function pdfMediaHoldFixture() {
  const reports = new Map(), uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  return (request,response,next) => {
    const url=new URL(request.url,'https://synthetic.invalid');
    if(url.pathname==='/api/__android-pdf-media-hold'&&['GET','POST'].includes(request.method)) {
      const id=url.searchParams.get('reportId'),hold=url.searchParams.get('hold');
      if(!uuid.test(id??'')||url.searchParams.size!==(request.method==='GET'?1:2)||(request.method==='POST'&&!['0','1'].includes(hold)))return response.status(400).json({held:false});
      if(request.method==='POST'&&hold==='1') {
        if(!reports.has(id)&&reports.size>=4)return response.status(503).json({held:false});
        reports.set(id,{held:true,requests:0,failures:0,statuses:[]});
      } else if(request.method==='POST'&&reports.has(id))reports.get(id).held=false;
      const state=reports.get(id);
      return state?response.json({...state,statuses:[...state.statuses]}):response.status(request.method==='GET'?404:200).json({held:false});
    }
    const match=/^\/api\/reports\/([a-f0-9-]{36})\/photos$/.exec(url.pathname);
    const state=request.method==='POST'&&match?reports.get(match[1]):null;
    if(!state)return next();
    state.requests++;response.once('finish',()=>{if(state.statuses.length<8)state.statuses.push(response.statusCode);});
    if(state.held){state.failures++;return response.status(503).set('Cache-Control','no-store').json({code:'fixture.media-unavailable'});}
    return next();
  };
}
