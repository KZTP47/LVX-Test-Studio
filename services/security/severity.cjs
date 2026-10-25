'use strict';
// CVSS v3 base score, with unrecognized/missing metadata deliberately retained as UNKNOWN.
function severityOf(vulnerability){
  const values=(Array.isArray(vulnerability.severity)?vulnerability.severity.map(item=>item?.score??item?.severity):[vulnerability.severity]);
  values.push(vulnerability.database_specific?.severity,vulnerability.ecosystem_specific?.severity);
  const rank=['LOW','MEDIUM','HIGH','CRITICAL'],mapped=[];
  for(const value of values){const text=String(value??'').toUpperCase();if(rank.includes(text)){mapped.push(text);continue;}if(text==='MODERATE'){mapped.push('MEDIUM');continue;}
    let score=/^\d+(?:\.\d+)?$/.test(text)?Number(text):NaN;
    if(/^CVSS:3\.[01]\//.test(text)){
      const fields=Object.fromEntries(text.split('/').slice(1).map(part=>part.split(':')));
      if(['U','C'].includes(fields.S)){
        const av={N:.85,A:.62,L:.55,P:.2}[fields.AV],ac={L:.77,H:.44}[fields.AC],pr=(fields.S==='C'?{N:.85,L:.68,H:.5}:{N:.85,L:.62,H:.27})[fields.PR],ui={N:.85,R:.62}[fields.UI],c={H:.56,L:.22,N:0}[fields.C],i={H:.56,L:.22,N:0}[fields.I],a={H:.56,L:.22,N:0}[fields.A];
        if([av,ac,pr,ui,c,i,a].every(Number.isFinite)){const iss=1-(1-c)*(1-i)*(1-a),impact=fields.S==='U'?6.42*iss:7.52*(iss-.029)-3.25*Math.pow(iss-.02,15),base=impact<=0?0:Math.min((fields.S==='C'?1.08:1)*(impact+8.22*av*ac*pr*ui),10);score=Math.ceil((base-1e-10)*10)/10;}
      }
    }
    if(Number.isFinite(score)&&score>=0&&score<=10)mapped.push(score>=9?'CRITICAL':score>=7?'HIGH':score>=4?'MEDIUM':'LOW');
  }
  return mapped.sort((a,b)=>rank.indexOf(b)-rank.indexOf(a))[0]||'UNKNOWN';
}
module.exports={severityOf};
