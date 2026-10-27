'use strict';

// A linear-space unified patch: unchanged prefix/suffix provide context, while
// the entire changed region remains reviewable. Unlike edit-distance searches,
// this has no edit-count deadline and its work scales with source size.
function sourcePatch(oldPath,newPath,oldSource,newSource){
 const lines=text=>text.match(/[^\n]*\n|[^\n]+$/g)||[];
 const before=lines(oldSource),after=lines(newSource);let prefix=0,suffix=0;
 while(prefix<before.length&&prefix<after.length&&before[prefix]===after[prefix])prefix++;
 while(suffix<before.length-prefix&&suffix<after.length-prefix&&before[before.length-1-suffix]===after[after.length-1-suffix])suffix++;
 const start=Math.max(0,prefix-3),oldEnd=Math.min(before.length,before.length-suffix+3),newEnd=Math.min(after.length,after.length-suffix+3),out=['===================================================================\n','--- '+oldPath+'\n','+++ '+newPath+'\n'];
 if(prefix===before.length&&prefix===after.length)return out.join('');
 const oldCount=oldEnd-start,newCount=newEnd-start;
 out.push('@@ -'+(oldCount?start+1:start)+','+oldCount+' +'+(newCount?start+1:start)+','+newCount+' @@\n');
 const emit=(marker,line)=>{out.push(marker+line);if(!line.endsWith('\n'))out.push('\n\\ No newline at end of file\n');};
 for(let i=start;i<prefix;i++)emit(' ',before[i]);
 for(let i=prefix;i<before.length-suffix;i++)emit('-',before[i]);
 for(let i=prefix;i<after.length-suffix;i++)emit('+',after[i]);
 for(let i=before.length-suffix;i<oldEnd;i++)emit(' ',before[i]);
 return out.join('');
}
module.exports={sourcePatch};
