export type Status = 'SUCCESS' | 'FAILURE' | 'ERROR' | 'CANCELLED' | 'RUNNING' | 'PENDING';
export interface TestCounts {total:number;passed:number;failed:number;errors:number;pending:number}
export type Engine = 'javascript'|'playwright'|'python'|'robot'|'java'|'csharp'|'jest'|'junit'|'nunit'|'pytest';
export type SecretReference = `secret:${string}`;
export interface ParameterRule {type?:'string'|'number'|'boolean'|'object'|'array'|'any';secret?:boolean;required?:boolean;minimum?:number;maximum?:number;enum?:unknown[];default?:unknown}
export interface Run extends TestCounts {id:string;name?:string;engine:Engine|'workflow';status:Status;stdout?:string;stderr?:string;startedAt?:string;finishedAt?:string;workspaceRoot?:string;artifacts:Record<string,unknown>;error?:string;originalRunId?:string}
export interface StartRun {engine:Engine;name?:string;code?:string;projectPath?:string;timeoutMs?:number;parameters?:Record<string,unknown|{secretRef:SecretReference}>;parameterSchema?:Record<string,ParameterRule>;fixtureId?:string;fixtureVersion?:number;inputFiles?:Array<{filename:string;content:string}>;websiteHTML?:string;websiteUrl?:string;debug?:boolean;workspaceRoot?:string}
export type RecordChange<T=unknown> = {collection:string;id:string;expectedRevision:number|null}&({value:T;delete?:false}|{delete:true;value?:never});
export interface WorkspaceRecord<T=unknown> {collection:string;id:string;revision:number;value:T}
export interface Workflow {schemaVersion:1;nodes:WorkflowNode[];edges:WorkflowEdge[];concurrency?:number}
export interface WorkflowNode {id:string;type:string;data:Record<string,unknown>;inputs?:Record<string,{type:string;required?:boolean}>;outputs?:Record<string,{type:string;required?:boolean}>;resources?:string[];retry?:{maxAttempts:number;backoffMs:number};onFailure?:'stop'|'continue'}
export interface WorkflowEdge {source:string;target:string;output?:string;input?:string;type?:string}
export interface StudioBridge {invoke(domain:'execution'|'workspace'|'security'|'host'|'agents'|'coordination',action:string,payload?:Record<string,unknown>):Promise<unknown>;chooseWorkspace():Promise<{workspaceRoot?:string;cancelled?:boolean}>;onEvent(listener:(event:Record<string,unknown>)=>void):()=>void}
export interface ExtensionManifest {id:string;apiVersion:1;capabilities:Array<'test.adapter'|'artifact.read'|'dataset.validate'|'workflow.validate'>}
export interface OperationError {__lvxError:{code:string;message:string;details?:unknown}}
export interface EngineCapability {id:Engine;available:boolean;runtimeAvailable:boolean;version?:string;prerequisite?:string;secretParameters:boolean;secretParametersPrerequisite?:string|null;debugger:{pause:boolean;resume:boolean;breakpoints:boolean;variables:boolean;stepOver:boolean;reason:string|null}}
export interface DebugFrame {authored:boolean;functionName:string;url:string;line:number|null;column:number|null;phase:'authored'|'setup-cleanup-or-wrapper'|'runtime'}
export interface DebugVariables {pausedInRuntime:boolean;stepOverAvailable:boolean;message:string|null;frame:DebugFrame|null;frames:DebugFrame[];variables:Array<{name:string;scope:string;type:string;value?:unknown;objectId?:string|null}>}
export interface ExecutionConfiguration {format:'lvx-execution-configuration';schemaVersion:1;fixtures:Array<{id:string;version:number;name:string;engine:Extract<Engine,'javascript'|'playwright'|'python'>;setup:string;cleanup:string}>;schedules:Array<{id:string;name:string;workflow:Workflow;intervalMs:number;missedRun:'skip'|'run-once';enabled:boolean;nextRun:string}>}
export interface StudioBridge {
 invoke(domain:'execution',action:'start',payload:StartRun):Promise<Run>;
 invoke(domain:'execution',action:'getRun',payload:{id:string;workspaceRoot?:string}):Promise<Run>;
 invoke(domain:'workspace',action:'read',payload:{collection:string;id:string;workspaceRoot?:string}):Promise<WorkspaceRecord|null>;
 invokeRaw(domain:'execution'|'workspace'|'security'|'host'|'agents'|'coordination',action:string,payload?:Record<string,unknown>):Promise<unknown|OperationError>;
 choosePath(payload:{kind:'dataset'|'project'|'runtime'|'jar'}):Promise<{path?:string;cancelled?:boolean}>;
 newWindow():Promise<{opened:boolean}>;
 openPreview(payload:{html:string;allowNetworkOrigins?:string[]}):Promise<{opened:boolean;isolated:boolean}>;
}
