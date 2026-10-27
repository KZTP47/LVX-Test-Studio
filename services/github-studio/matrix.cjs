'use strict';

// The matrix is a decision tree, not an allocated Cartesian product. Subtree
// counts let the viewer jump directly to any page, including beyond 2^53 rows.
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const mapping=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const equal=(a,b)=>{const pending=[[a,b]],seen=new WeakMap();while(pending.length){const [x,y]=pending.pop();if(Object.is(x,y))continue;if(!x||!y||typeof x!=='object'||typeof y!=='object'||Array.isArray(x)!==Array.isArray(y))return false;if(seen.get(x)?.has(y))continue;if(!seen.has(x))seen.set(x,new WeakSet());seen.get(x).add(y);const keys=Object.keys(x);if(keys.length!==Object.keys(y).length)return false;for(const k of keys){if(!own(y,k))return false;pending.push([x[k],y[k]]);}}return true;};
function expandMatrix(matrix,{limit=100,offset=0}={}){
 if(!Number.isSafeInteger(limit)||limit<0)throw Object.assign(Error('Choose a nonnegative safe page size; zero requests every remaining combination.'),{code:'MATRIX_LIMIT'});
 let skip;try{if(typeof offset==='number'&&!Number.isSafeInteger(offset))throw Error();if(!/^\d+$/.test(String(offset)))throw Error();skip=BigInt(offset);}catch{throw Object.assign(Error('Matrix offset must be a nonnegative integer.'),{code:'MATRIX_OFFSET'});}
 const start=skip,diagnostics=[],result={combinations:[],total:0,dynamic:false,truncated:false,diagnostics,offset:String(start),nextOffset:null};
 const dynamic=value=>{const pending=[value],seen=new WeakSet();while(pending.length){const v=pending.pop();if(typeof v==='string'&&v.includes('${{'))return true;if(v&&typeof v==='object'&&!seen.has(v)){seen.add(v);for(const item of Object.values(v))pending.push(item);}}return false;};
 if(dynamic(matrix)){result.dynamic=true;diagnostics.push({code:'DYNAMIC_MATRIX',message:'Matrix depends on runtime expressions.',severity:'warning'});return result;}
 const invalid=()=>{diagnostics.push({code:'INVALID_MATRIX',message:'Matrix dimensions must be arrays and include/exclude must be arrays of mappings.',severity:'error'});return result;};
 if(!mapping(matrix))return invalid();
 const entries=Object.entries(matrix).filter(([k])=>!['include','exclude'].includes(k)),include=matrix.include??[],exclude=matrix.exclude??[];
 if(entries.some(([,v])=>!Array.isArray(v))||!Array.isArray(include)||!Array.isArray(exclude)||[...include,...exclude].some(v=>!mapping(v)))return invalid();
 const keys=new Set(entries.map(([k])=>k));
 const rules=exclude.filter(rule=>Object.keys(rule).every(k=>keys.has(k)));
 function counter(constraints={}){
  const memo=new Map();
  const allowed=entries.map(([key,values])=>own(constraints,key)?values.filter(value=>equal(value,constraints[key])):values);
  const tails=Array(entries.length+1).fill(1n);for(let i=entries.length-1;i>=0;i--)tails[i]=tails[i+1]*BigInt(allowed[i].length);
  function count(at,active){
   const frames=[{at,active,index:0,sum:0n}];let answer=0n;
   while(frames.length){
    const frame=frames.at(-1),key=frame.at+':'+frame.active.join(',');
    const direct=!entries.length?0n:!frame.active.length?tails[frame.at]:frame.at===entries.length?0n:memo.get(key);
    if(direct!==undefined||frame.index===allowed[frame.at]?.length){
     const value=direct??frame.sum;memo.set(key,value);frames.pop();if(frames.length)frames.at(-1).sum+=value;else answer=value;continue;
    }
    const name=entries[frame.at][0],value=allowed[frame.at][frame.index++];
    frames.push({at:frame.at+1,active:frame.active.filter(id=>!own(rules[id],name)||equal(rules[id][name],value)),index:0,sum:0n});
   }
   return answer;
  }
  return {count,allowed,active:rules.map((_,i)=>i)};
 }
 const tree=counter(),base=tree.count(0,tree.active);
 const additions=include.filter(row=>counter(row).count(0,tree.active)===0n);
 const total=base+BigInt(additions.length),room=()=>limit===0||result.combinations.length<limit;
 if(base&&room()){
  const row=Object.create(null),frames=[{at:0,active:tree.active,index:0,entered:false}];
  while(frames.length&&room()){
   const frame=frames.at(-1);
   if(!frame.entered){
    const count=tree.count(frame.at,frame.active);if(skip>=count){skip-=count;frames.pop();continue;}
    if(frame.at===entries.length){
     let augmented=Object.fromEntries(Object.entries(row));for(const addition of include)if(Object.entries(addition).every(([k,v])=>!own(row,k)||equal(row[k],v)))augmented=Object.fromEntries([...Object.entries(augmented).filter(([k])=>!own(addition,k)),...Object.entries(addition)]);
     result.combinations.push(augmented);frames.pop();continue;
    }
    frame.entered=true;
   }
   const name=entries[frame.at][0];
   if(frame.index===tree.allowed[frame.at].length){delete row[name];frames.pop();continue;}
   const value=tree.allowed[frame.at][frame.index++];row[name]=value;
   frames.push({at:frame.at+1,active:frame.active.filter(id=>!own(rules[id],name)||equal(rules[id][name],value)),index:0,entered:false});
  }
 }
 for(const row of additions){if(skip){skip--;continue;}if(!room())break;result.combinations.push(row);}
 const end=start+BigInt(result.combinations.length);
 result.total=total<=BigInt(Number.MAX_SAFE_INTEGER)?Number(total):String(total);
 result.baseCombinations=base<=BigInt(Number.MAX_SAFE_INTEGER)?Number(base):String(base);
 result.truncated=end<total;result.nextOffset=result.truncated?String(end):null;
 return result;
}
module.exports={expandMatrix};
