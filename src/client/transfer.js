// Embedded in the native Client module by build-client.mjs.
(() => {
  const format = 'dsh-agentdeck-models';
  const fail = () => { throw { code: 'modelTransferInvalid', message: 'modelTransferInvalid' }; };
  const text = value => typeof value === 'string' && value.trim() && !value.includes('\0');
  const id = value => text(value) && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function reasoning(value, candidate = false) {
    if (!object(value) || !(candidate ? ['model-default', 'fixed'] : ['inherit-compatible', 'model-default', 'fixed']).includes(value.mode)) fail();
    if (value.mode === 'fixed') { if (!text(value.effort)) fail(); return { mode: 'fixed', effort: value.effort }; }
    if (value.effort !== undefined) fail();
    return { mode: value.mode };
  }
  function route(value) {
    if (!object(value) || !text(value.provider) || !text(value.model)) fail();
    return { provider: value.provider, model: value.model };
  }
  // Reconstruct the allowlist: file data never carries instructions, secrets or paths.
  function settings(value) {
    if (!object(value) || !object(value.model)) fail();
    const model = value.model;
    let parsed;
    if (model.mode === 'inherit') parsed = { mode: 'inherit' };
    else if (model.mode === 'fixed') parsed = { mode: 'fixed', ...route(model) };
    else if (model.mode === 'auto') {
      if (!Array.isArray(model.candidates) || !model.candidates.length) fail();
      const candidates = model.candidates.map(item => {
        if (!object(item) || !id(item.id) || !text(item.purpose) || item.purpose.length > 240) fail();
        return { id: item.id, purpose: item.purpose, ...route(item), reasoning: reasoning(item.reasoning, true) };
      });
      if (new Set(candidates.map(item => item.id)).size !== candidates.length || !candidates.some(item => item.id === model.defaultCandidate)) fail();
      parsed = { mode: 'auto', candidates, defaultCandidate: model.defaultCandidate };
    } else fail();
    const parsedReasoning = reasoning(value.reasoning);
    if (parsed.mode === 'auto' && parsedReasoning.mode !== 'model-default') fail();
    return { model: parsed, reasoning: parsedReasoning };
  }
  function packet(roles) {
    if (!Array.isArray(roles) || !roles.length) fail();
    const entries = roles.map(item => { if (!object(item) || !id(item.id)) fail(); return { id: item.id, ...settings(item) }; });
    if (new Set(entries.map(item => item.id)).size !== entries.length) fail();
    return { format, version: 1, roles: entries };
  }
  function write(roles) {
    const encoded = JSON.stringify(packet(roles), null, 2) + '\n';
    if (new TextEncoder().encode(encoded).length > 1024 * 1024) throw { code: 'importTooLarge', message: 'importTooLarge' };
    return encoded;
  }
  function read(encoded) {
    if (typeof encoded !== 'string') fail();
    if (new TextEncoder().encode(encoded).length > 1024 * 1024) throw { code: 'importTooLarge', message: 'importTooLarge' };
    let parsed;
    try { parsed = JSON.parse(encoded.replace(/^\uFEFF/, '')); } catch { fail(); }
    if (!object(parsed) || parsed.format !== format || parsed.version !== 1) fail();
    return packet(parsed.roles);
  }
  function routes(config) {
    return config.model.mode === 'auto' ? config.model.candidates.map(item => ({ key: item.id, ...item }))
      : config.model.mode === 'fixed' ? [{ key: '@fixed', ...route(config.model), reasoning: config.reasoning }] : [];
  }
  function replaceRoute(config, key, patch) {
    const clean = settings(config);
    if (clean.model.mode === 'fixed' && key === '@fixed') return settings({ model: { ...clean.model, ...patch }, reasoning: patch.reasoning || clean.reasoning });
    if (clean.model.mode !== 'auto' || !clean.model.candidates.some(item => item.id === key)) fail();
    return settings({ ...clean, model: { ...clean.model, candidates: clean.model.candidates.map(item => item.id === key ? { ...item, ...patch } : item) } });
  }
  function routeIssue(entry, metadata) {
    if (!metadata?.metadataResolved) return 'transferUnresolved';
    if (Array.isArray(metadata.inputModalities) && !metadata.inputModalities.includes('text')) return 'transferTextRequired';
    const efforts = Array.isArray(metadata.efforts) ? metadata.efforts : [];
    if (entry.reasoning.mode === 'fixed' && !efforts.some(effort => (typeof effort === 'string' ? effort : effort?.id) === entry.reasoning.effort)) return 'transferEffortMissing';
    return '';
  }
  return { read, write, settings, routes, replaceRoute, routeIssue };
})()
