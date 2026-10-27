// Acquisition failures belong to a repository, not the whole board.
export async function collectApiSnapshots(repositories, { loadSources, localOnly = false, onProgress = () => {}, isCurrent = () => true } = {}) {
  const snapshots = [];
  for (const [index, repo] of repositories.entries()) {
    if (!isCurrent()) throw Error('The API view changed during the scan.');
    onProgress(`Reading ${repo.fullName} (${index + 1}/${repositories.length})…`);
    let loaded = { files: [], skipped: [], complete: false };
    if (!localOnly) {
      try { loaded = await loadSources(repo, index); }
      catch (error) {
        if (error.code === 'WORKSPACE_CHANGED') throw error;
        loaded = { files: [], skipped: [{ path: '', reason: error.message }], complete: false };
      }
    }
    const files = new Map((loaded.files || []).map(file => [file.path, file]));
    for (const file of repo.files || []) files.set(file.path, file);
    const scanStatus = localOnly ? 'imported-only' : loaded.complete === false ? 'partial' : 'scanned';
    const skipped = [...(loaded.skipped || [])];
    if (scanStatus === 'imported-only') skipped.push({ path: '', reason: 'Only source already imported into LVX was inspected. Fetch repository source for wider API coverage.' });
    snapshots.push({ ...repo, files: [...files.values()], skipped, scanStatus });
  }
  return snapshots;
}

export function retainPartialEvidence(previous, next) {
  const partial = new Set(next.services.filter(service => service.scanStatus !== 'scanned' && previous.services.some(old => old.id === service.id && old.commit === service.commit)).map(service => service.id));
  for (const [key, owner] of [['endpoints', 'serviceId'], ['connections', 'source'], ['candidates', 'serviceId'], ['apiServices', 'repositoryId']]) {
    next[key] ||= [];
    const ids = new Set(next[key].map(item => item.id));
    for (const item of previous[key] || []) {
      const service = next.services.find(service => service.id === item[owner]);
      const evidence = [].concat(item.evidence || []);
      const superseded = evidence.length && evidence.every(source => service?.inspectedPaths?.includes(source.path));
      if (!superseded && partial.has(item[owner]) && !ids.has(item.id) && (key !== 'connections' || !item.target || next.services.some(service => service.id === item.target))) next[key].push({ ...item, retained: true });
    }
  }
  const ids = new Set((next.externalNodes || []).map(node => node.id));
  next.externalNodes ||= [];
  for (const node of previous.externalNodes || []) if (!ids.has(node.id) && next.connections.some(edge => edge.externalId === node.id)) next.externalNodes.push(node);
  if (partial.size) next.diagnostics.push({ path: '', message: 'Earlier API evidence at the same commit is retained for incomplete repositories. Runtime availability has not been checked.' });
  return next;
}

export function networkConnections(atlas) {
  const connections = [], configured = new Map();
  for (const edge of atlas.connections) {
    if (!edge.defaultOnly) { connections.push(edge); continue; }
    const key = JSON.stringify([edge.source, edge.targetApiServiceId || edge.target || edge.externalId || edge.url]);
    if (configured.has(key)) { const group = configured.get(key); group.declarationCount++; group.declarations.push(edge.evidence); }
    else { const group = { ...edge, declarationCount: 1, declarations: [edge.evidence] }; configured.set(key, group); connections.push(group); }
  }
  return [...connections, ...(atlas.apiServices || []).map(service => ({ id: 'owns-' + service.id, source: service.repositoryId, target: service.id, method: 'Defines', url: service.title, confidence: 'API description in repository', kind: 'ownership', evidence: service.evidence }))];
}
// Scope comes from stable graph identities, never the current text/service filter.
export function apiSection(atlas, kind, id) {
  const node = [...atlas.services, ...(atlas.apiServices || []), ...(atlas.externalNodes || [])].find(node => node.id === id) || (id === 'unresolved' ? {id,type:'unknown',title:'Unresolved destinations'} : null);
  if (kind === 'node') {
    if (!node) return null;
    return { kind, id, title: node.title || node.name, description: node.type === 'external' ? 'External destination. Import its provider API description to discover endpoints.' : 'Endpoints declared by this section.', evidence: node.evidence ? [node.evidence] : [], endpoints: atlas.endpoints.filter(ep => node.type === 'api-service' ? ep.apiServiceId === id : ep.serviceId === id) };
  }
  if (kind === 'endpoint') {
    const ep = atlas.endpoints.find(ep => ep.id === id);
    return ep ? { kind, id, title: ep.method + ' ' + ep.path, description: 'Tests for this endpoint.', evidence: ep.evidence, endpoints: [ep] } : null;
  }
  const edge = networkConnections(atlas).find(edge => edge.id === id) || atlas.connections.find(edge => edge.id === id);
  if (!edge) return null;
  const source = atlas.services.find(service => service.id === edge.source), target = [...atlas.services, ...(atlas.apiServices || []), ...(atlas.externalNodes || [])].find(service => service.id === (edge.targetApiServiceId || edge.target || edge.externalId));
  const endpoints = atlas.endpoints.filter(ep => edge.kind === 'ownership' ? ep.apiServiceId === edge.target : edge.endpointId ? ep.id === edge.endpointId : edge.targetApiServiceId ? ep.apiServiceId === edge.targetApiServiceId : edge.target ? ep.serviceId === edge.target : ep.connectionId === edge.id);
  return { kind, id, title: (source?.title || source?.name || 'Caller') + ' → ' + (target?.title || target?.name || edge.url), description: edge.kind === 'ownership' ? 'API endpoints defined by this repository.' : edge.defaultOnly ? 'Configured provider endpoints. This default may be overridden at runtime; it does not identify which operations the caller uses.' : edge.confidence, evidence: edge.declarations || [edge.evidence], endpoints, edge };
}
