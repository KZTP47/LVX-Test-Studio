'use strict';
// A conversation keeps its native identity and working folder when another is selected.
function snapshot(session) { const {conversations,...value}=session;return value; }
function entries(session) {
 const all=new Map((session.conversations||[]).map(s=>[s.generation,s]));
 all.set(session.generation,snapshot(session));return [...all.values()].sort((a,b)=>a.generation-b.generation);
}
function activate(session,next) {return {...snapshot(next),generationCounter:Math.max(session.generationCounter||0,next.generation,...entries(session).map(s=>s.generation)),conversations:entries(session).filter(s=>s.generation!==next.generation)};}
function nextGeneration(session){return Math.max(session.generationCounter||0,...entries(session).map(s=>s.generation))+1;}
function summaries(session){return entries(session).map(s=>({generation:s.generation,name:s.name||'Conversation '+s.generation,archived:!!s.archived,workingDirectory:s.workingDirectory,activeProjectId:s.activeProjectId||'',active:s.generation===session.generation,createdAt:s.createdAt}));}
module.exports={snapshot,entries,activate,nextGeneration,summaries};
