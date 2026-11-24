window.__ModuleLoader__.load({
  id: 'dsh-agentdeck',
  factory(require) {
    'use strict';
    const React = require('react');
    const h = React.createElement;
    const NS = 'agentdeck';
    const dictionaries = /* AGENTDECK_LOCALES */ null;
    const modelTransfer = /* AGENTDECK_TRANSFER */ null;
    const definitionKeys = ['schemaVersion', 'id', 'title', 'description', 'instructions', 'capabilities', 'skills', 'scripts', 'inputs', 'deliverables', 'model', 'reasoning', 'enabled', 'extends'];
    function definitionOf(agent) {
      return Object.fromEntries(definitionKeys.filter(key => agent[key] !== undefined).map(key => [key, agent[key]]));
    }
    // JSON is a YAML 1.2 subset, so generated edits need no second YAML parser.
    function definitionText(agent) { return JSON.stringify(definitionOf(agent), null, 2) + '\n'; }
    function recordDefinitionAction(actions, action) {
      const key = JSON.stringify(action.path);
      return [...(actions || []).filter(item => JSON.stringify(item.path) !== key), action];
    }
    function isDirty(draft) { return Boolean(draft && (draft.actions?.length || draft.text !== draft.baseline)); }
    const validText = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
    const validCandidateId = value => validText(value) && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
    function formIssues(form) {
      if (!form) return [];
      const issues = [];
      if (form.model?.mode === 'fixed' && (!validText(form.model.provider) || !validText(form.model.model))) issues.push({ key: 'invalidRoute' });
      if (form.model?.mode !== 'auto' && form.reasoning?.mode === 'fixed' && !validText(form.reasoning.effort)) issues.push({ key: 'invalidEffort' });
      if (form.model?.mode === 'auto') {
        const candidates = form.model.candidates || [];
        if (candidates.length < 1 || new Set(candidates.map(item => item.id)).size !== candidates.length || !candidates.some(item => item.id === form.model.defaultCandidate)) issues.push({ key: 'invalidCandidates' });
        candidates.forEach((item, index) => {
          if (!validCandidateId(item.id) || !validText(item.purpose) || item.purpose.length > 240 || !validText(item.provider) || !validText(item.model) || !['model-default', 'fixed'].includes(item.reasoning?.mode) || item.reasoning.mode === 'fixed' && !validText(item.reasoning.effort)) issues.push({ key: 'invalidCandidate', number: index + 1 });
        });
      }
      return issues;
    }
    function roleView(agent, preview, defaultRoute = false) {
      if (!agent || preview?.agent?.id !== agent.id || preview.agent.revision !== agent.revision) return agent;
      if (!defaultRoute) return preview.agent;
      // Live capability evidence also updates the list. Its model badge still describes the saved default.
      const sameChoice = JSON.stringify(preview.configuredSelection) === JSON.stringify(agent.configuredSelection);
      return { ...preview.agent, validation: sameChoice ? preview.agent.validation : undefined, authorization: agent.authorization, configuredSelection: agent.configuredSelection,
        available: Boolean((!sameChoice || !preview.agent.validation || preview.agent.validation === 'valid') && preview.agent.capabilitiesAvailable && agent.authorization?.status === 'authorized') };
    }
    function roleStatus(agent, selectedModel = false, sessionSelected = true) {
      if (!agent.enabled) return 'disabled';
      if (agent.authorization?.status === 'denied') return selectedModel ? 'selectedModelDenied' : 'modelDenied';
      if (agent.validation === 'invalid') return 'unavailable';
      if (agent.validation === 'unverified') return 'unknown';
      if (agent.missingCapabilities?.length) return 'unavailable';
      if (agent.unverifiedCapabilities?.length) return 'capabilityUnknown';
      if (!sessionSelected) return 'noSession';
      if (agent.authorization?.status !== 'authorized') return 'authorizationUnknown';
      return agent.available ? 'available' : 'unavailable';
    }
    function RoleStatusBadge({ agent, selectedModel, sessionSelected, t }) {
      const status = roleStatus(agent, selectedModel, sessionSelected);
      const className = status === 'noSession' ? 'ad-muted' : agent.available ? 'ad-status' : 'ad-warning';
      return h('span', { className }, t(status));
    }
    // Model metadata and Session authorization remain independent facts.
    function previewFacts(preview, sessionId) {
      return {
        configuredSelection: preview?.configuredSelection,
        effectiveSelection: preview?.effectiveSelection,
        authorization: sessionId ? preview?.authorization || { status: 'unknown' } : { status: 'unknown' },
        recovery: preview?.recovery || { policy: 'native' }
      };
    }
    const sessionPreviewDiagnostics = new Set([
      'Select a live Session to validate authorization and effective output parameters. Model declarations and configured capacity are not task admission.',
      'Select a live Session to resolve inherited model parameters.'
    ]);
    function isSessionPreviewDiagnostic(item) { return typeof item === 'string' && sessionPreviewDiagnostics.has(item); }
    function previewNeedsSession(items) { return Array.isArray(items) && items.some(isSessionPreviewDiagnostic); }
    function previewDiagnostics(items, sessionId) { return !sessionId && Array.isArray(items) ? items.filter(item => !isSessionPreviewDiagnostic(item)) : items; }
    function selectionOptions(selected, items, loaded) {
      return selected && !items.some(item => item.id === selected)
        ? [{ id: selected, name: selected, availability: loaded ? 'unavailable' : 'unknown' }, ...items]
        : items;
    }
    function optionText(value, fallback) {
      return typeof value === 'string' ? value : value && typeof value === 'object'
        ? typeof value.name === 'string' ? value.name : typeof value.id === 'string' ? value.id : fallback
        : fallback;
    }
    const optionsKey = provider => 'modelOptions:' + JSON.stringify(provider);
    const metadataKey = (provider, model) => 'modelMetadata:' + JSON.stringify([provider, model]);
    function fault(error) {
      return { code: error?.code || 'requestFailed', message: error?.message || String(error), details: error?.details };
    }
    function createController(connection) {
      let disposed = false;
      let state = {
        catalog: null, selectedId: '', sessionId: '', runParentId: '', runParents: [], tab: 'roles', drafts: {},
        evidence: {}, suggestions: {}, changePreview: null, changeAccepted: {}, transfer: null,
        models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, suggestionModelOptions: {}, preview: null, previewCandidates: {}, runs: null, runCursor: null, result: null, resultChild: '', resultStale: false,
        creating: false, newId: '', newBase: 'general', imported: false, identity: null,
        errors: {}, busy: {}, notice: ''
      };
      const listeners = new Set();
      const requests = new Map();
      let modelGeneration = 0;
      let modelReadKey;
      let previewReadKey;
      let refreshing = false;
      const providerLists = new Map();
      const exactModels = new Map();
      let providersRead;
      const suggestionModelReads = new Map();
      const publish = patch => {
        if (disposed) return;
        if ('transfer' in patch && patch.transfer?.token !== state.transfer?.token) requests.get('transfer')?.abort();
        state = { ...state, ...patch };
        for (const listener of listeners) listener();
      };
      function error(key, value) { publish({ errors: { ...state.errors, [key]: value ? fault(value) : null } }); }
      async function request(key, endpoint, payload, accept, timeoutMs = 15000) {
        requests.get(key)?.abort();
        const controller = new AbortController();
        requests.set(key, controller);
        publish({ busy: { ...state.busy, [key]: true }, errors: { ...state.errors, [key]: null } });
        const startedAt = Date.now();
        let timer;
        let abort;
        let timedOut = false;
        let reportedFailure = false;
        const readOnly = ['catalog', 'models', 'modelOptions', 'preview', 'suggest', 'previewChange', 'inspectDefinition', 'runs', 'result'].includes(endpoint);
        try {
          const call = connection.rpc.call('/agentdeck', 'agentdeck.' + endpoint, payload, controller.signal);
          const result = await (readOnly ? Promise.race([call, new Promise((_, reject) => {
            abort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', abort, { once: true });
          }), new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOut = true;
              reject({ code: 'requestTimeout', message: 'requestTimeout' });
              controller.abort();
            }, timeoutMs);
          })]) : call);
          if (disposed || controller.signal.aborted || requests.get(key) !== controller) return { ok: false, aborted: true };
          if (!result || typeof result.ok !== 'boolean') throw { code: 'malformedResponse', message: 'malformedResponse' };
          if (!result.ok) {
            if (result.error?.code !== 'AGENTDECK_WRITE_OUTCOME_UNKNOWN') reportedFailure = true;
            throw result.error;
          }
          accept?.(result.value);
          return { ok: true, value: result.value };
        } catch (cause) {
          if (disposed || requests.get(key) !== controller || (controller.signal.aborted && !timedOut)) return { ok: false, aborted: true };
          const failure = timedOut ? { code: 'requestTimeout', message: 'requestTimeout', details: { operation: endpoint, elapsedMs: Date.now() - startedAt } } : cause;
          if (key === 'result' && failure?.code === 'AGENTDECK_RESULT_CHANGED') {
            publish({ resultStale: true, runs: clearRunEvidence(state.resultChild) });
          }
          error(key, failure);
          return { ok: false, error: fault(failure), ...(!readOnly && !reportedFailure ? { uncertain: true } : {}) };
        } finally {
          clearTimeout(timer);
          if (abort) controller.signal.removeEventListener('abort', abort);
          if (!disposed && requests.get(key) === controller) {
            requests.delete(key);
            publish({ busy: { ...state.busy, [key]: false } });
          }
        }
      }
      const sessionPayload = () => state.sessionId ? { sessionId: state.sessionId } : {};
      const runSessionPayload = () => state.runParentId ? { parentId: state.runParentId } : {};
      const findAgent = id => state.catalog?.agents.find(agent => agent.id === id);
      const findOverride = id => state.catalog?.overrides.find(override => override.id === id);
      function makeDraft(id) {
        const agent = findAgent(id);
        const override = findOverride(id);
        const text = override?.text ?? (agent ? definitionText(agent) : '');
        return { text, baseline: text, expectedRevision: override?.revision, form: agent ? definitionOf(agent) : null, actions: [], kind: 'raw' };
      }
      function canEdit(id) {
        return (state.drafts[id]?.writeSessionId || '') === state.sessionId;
      }
      function useProjectEdit(id) {
        if (!state.sessionId || (!findAgent(id) && !findOverride(id)) || isDirty(state.drafts[id])) return false;
        invalidateChange();
        publish({ drafts: { ...state.drafts, [id]: { ...makeDraft(id), writeSessionId: state.sessionId } } });
        return true;
      }
      function ensureDraft(id) {
        if (!state.drafts[id]) publish({ drafts: { ...state.drafts, [id]: makeDraft(id) } });
      }
      async function loadCatalog() {
        requests.get('preview')?.abort(); requests.delete('preview');
        previewReadKey = undefined;
        publish({ preview: null, evidence: {}, busy: { ...state.busy, preview: false } });
        return request('catalog', 'catalog', sessionPayload(), catalog => {
          const drafts = { ...state.drafts };
          const overrideById = new Map(catalog.overrides.map(item => [item.id, item]));
          for (const agent of catalog.agents) {
            if (!isDirty(drafts[agent.id])) {
              const override = overrideById.get(agent.id);
              const text = override?.text ?? definitionText(agent);
              drafts[agent.id] = { text, baseline: text, expectedRevision: override?.revision, form: definitionOf(agent), actions: [], kind: 'raw', ...(state.sessionId && drafts[agent.id]?.writeSessionId === state.sessionId ? { writeSessionId: state.sessionId } : {}) };
            }
          }
          for (const override of catalog.overrides) {
            if (!drafts[override.id]) drafts[override.id] = { text: override.text, baseline: override.text, expectedRevision: override.revision, form: null, actions: [], kind: 'raw' };
          }
          const ids = new Set([...catalog.agents.map(agent => agent.id), ...catalog.overrides.map(item => item.id), ...Object.keys(drafts).filter(id => id !== '@new' && isDirty(drafts[id]))]);
          const selectedId = ids.has(state.selectedId) ? state.selectedId : (catalog.agents[0]?.id || catalog.overrides[0]?.id || '');
          publish({ catalog, drafts, selectedId, evidence: {} });
        });
      }
      function select(id) { ensureDraft(id); invalidateChange(); publish({ selectedId: id, creating: false, preview: null, notice: '' }); }
      function edit(id, text) {
        if (!canEdit(id)) return;
        invalidateSuggestion(id); invalidateChange();
        ensureDraft(id);
        publish({ drafts: { ...state.drafts, [id]: { ...state.drafts[id], text, actions: [], kind: 'raw' } }, notice: '', ...(id === '@new' ? { imported: true, identity: null } : {}) });
        if (id === '@new') void inspectNew(text);
      }
      async function openForm(id) {
        const draft = state.drafts[id];
        if (!draft || draft.kind !== 'raw' || !isDirty(draft)) return;
        const answer = await previewChange(id);
        if (answer.ok && state.drafts[id] === draft && state.changePreview?.draftId === id && answer.value.direct?.after) {
          publish({ drafts: { ...state.drafts, [id]: { ...draft, kind: 'form', formBaseText: draft.text, form: definitionOf(answer.value.direct.after), actions: [], materialized: true } } });
        }
      }
      async function restoreField(id, field) {
        const draft = state.drafts[id];
        if (!canEdit(id) || !draft?.form || (draft.kind === 'raw' && isDirty(draft))) return;
        invalidateSuggestion(id); invalidateChange();
        const actions = (draft.actions || []).filter(action => action.path[0] !== field);
        const next = { ...draft, kind: 'form', materialized: false, actions: [...actions, { path: [field], op: 'delete' }] };
        publish({ drafts: { ...state.drafts, [id]: next } });
        const answer = await previewChange(id);
        const current = state.drafts[id];
        if (answer.ok && current?.actions === next.actions && answer.value.direct?.after) {
          publish({ drafts: { ...state.drafts, [id]: { ...current, form: definitionOf(answer.value.direct.after) } } });
        }
      }
      function updateForm(id, patch) {
        ensureDraft(id);
        const draft = state.drafts[id];
        if (!canEdit(id) || !draft.form || (isDirty(draft) && draft.kind === 'raw')) return;
        invalidateSuggestion(id); invalidateChange();
        const form = { ...draft.form, ...patch, schemaVersion: 3 };
        let actions = recordDefinitionAction(draft.actions, { path: ['schemaVersion'], op: 'set', value: 3 });
        for (const [key, value] of Object.entries(patch)) actions = recordDefinitionAction(actions, value === undefined ? { path: [key], op: 'delete' } : { path: [key], op: 'set', value });
        if (patch.model?.mode === 'auto') {
          form.reasoning = { mode: 'model-default' };
          actions = recordDefinitionAction(actions, { path: ['reasoning'], op: 'set', value: form.reasoning });
        }
        publish({ drafts: { ...state.drafts, [id]: { ...draft, form, actions, materialized: false, kind: 'form' } }, notice: '' });
      }
      function setModelMode(id, mode) {
        ensureDraft(id);
        const form = state.drafts[id]?.form;
        if (!form || form.model.mode === mode) return;
        const candidate = form.model.mode === 'auto' && form.model.candidates.find(item => item.id === form.model.defaultCandidate);
        const route = candidate || (form.model.mode === 'fixed' ? form.model : state.preview?.effectiveSelection || state.preview?.configuredSelection);
        const reasoning = candidate?.reasoning || (form.model.mode === 'fixed' ? form.reasoning : { mode: 'model-default' });
        const model = mode === 'auto' ? { mode, defaultCandidate: 'default', candidates: [{ id: 'default', purpose: '', provider: route?.provider || '', model: route?.model || '', reasoning: reasoning.mode === 'fixed' ? reasoning : { mode: 'model-default' } }] } : mode === 'fixed' ? { mode, provider: route?.provider || '', model: route?.model || '' } : { mode: 'inherit' };
        updateForm(id, { model, reasoning: mode === 'inherit' ? { mode: 'inherit-compatible' } : reasoning });
      }
      function updateCandidate(id, index, patch) {
        const model = state.drafts[id]?.form?.model;
        if (model?.mode !== 'auto' || !model.candidates[index]) return;
        const previous = model.candidates[index];
        updateForm(id, { model: { ...model, candidates: model.candidates.map((item, at) => at === index ? { ...item, ...patch } : item), defaultCandidate: model.defaultCandidate === previous.id && patch.id !== undefined ? patch.id : model.defaultCandidate } });
      }
      function addCandidate(id) {
        const model = state.drafts[id]?.form?.model;
        if (model?.mode !== 'auto') return;
        let candidateId = 'candidate-2';
        for (let number = 2; model.candidates.some(item => item.id === candidateId); number++) candidateId = 'candidate-' + (number + 1);
        updateForm(id, { model: { ...model, candidates: [...model.candidates, { id: candidateId, purpose: '', provider: '', model: '', reasoning: { mode: 'model-default' } }] } });
      }
      function removeCandidate(id, index) {
        const model = state.drafts[id]?.form?.model;
        if (model?.mode !== 'auto' || model.candidates.length <= 1) return;
        const candidates = model.candidates.filter((_, at) => at !== index);
        updateForm(id, { model: { ...model, candidates, defaultCandidate: candidates.some(item => item.id === model.defaultCandidate) ? model.defaultCandidate : candidates[0].id } });
      }
      function selectPreviewCandidate(id, candidateId) {
        const model = findAgent(id)?.model;
        if (model?.mode !== 'auto' || !model.candidates.some(item => item.id === candidateId)) return;
        publish({ previewCandidates: { ...state.previewCandidates, [id]: candidateId }, preview: null });
      }
      function beginCreate(base = state.selectedId || 'general') {
        if (!canEdit(base) || (state.sessionId && !findAgent(base))) return;
        if (isDirty(state.drafts['@new'])) { publish({ creating: true, notice: 'existingNewDraft' }); return; }
        requests.get('identity')?.abort();
        invalidateChange();
        const text = JSON.stringify({ schemaVersion: 3, id: '', extends: base }, null, 2) + '\n';
        publish({ creating: true, newId: '', newBase: base, imported: false, identity: null, notice: '', drafts: { ...state.drafts, '@new': { text, baseline: text, kind: 'raw', form: null, writeSessionId: state.sessionId } } });
      }
      async function inspectNew(text) {
        return request('identity', 'inspectDefinition', { text }, value => {
          if (state.drafts['@new']?.text !== text) return;
          if (!validCandidateId(value?.id)) throw { code: 'malformedResponse', message: 'malformedResponse' };
          publish({ identity: { text, id: value.id } });
        });
      }
      function updateNewTemplate(id, base) {
        const draft = state.drafts['@new'];
        if (!draft || state.imported || !canEdit('@new')) return;
        invalidateChange();
        const text = JSON.stringify({ schemaVersion: 3, id, extends: base }, null, 2) + '\n';
        publish({ newId: id, newBase: base, identity: null, drafts: { ...state.drafts, '@new': { ...draft, text } } });
        if (id) void inspectNew(text);
      }
      function setNewId(id) { updateNewTemplate(id, state.newBase); }
      function setNewBase(base) { updateNewTemplate(state.newId, base); }
      function openModelExport() {
        publish({ transfer: { mode: 'export', token: {}, rows: (state.catalog?.agents || []).map(agent => ({ id: agent.id, selected: true })) }, errors: { ...state.errors, transfer: null } });
      }
      function exportModels() {
        const roles = state.transfer?.mode === 'export' ? state.transfer.rows.filter(row => row.selected).map(row => findAgent(row.id)).filter(Boolean) : [];
        return modelTransfer.write(roles);
      }
      function importModels(text) {
        if (state.sessionId || state.busy.save || state.busy.reset || state.busy.changeReceipt) return false;
        try {
          const packet = modelTransfer.read(text);
          const rows = packet.roles.map(entry => {
            const target = findAgent(entry.id);
            return { id: entry.id, selected: Boolean(target), targetId: target?.id || '', targetRevision: target?.revision, config: modelTransfer.settings(entry) };
          });
          publish({ transfer: { mode: 'import', token: {}, rows }, errors: { ...state.errors, transfer: null }, notice: '' });
          void checkModelTransfer();
          return true;
        } catch (cause) { error('transfer', cause); return false; }
      }
      function updateModelTransfer(index, patch) {
        const transfer = state.transfer;
        if (!transfer || transfer.checking || state.busy.changeReceipt) return;
        if (patch.targetId !== undefined) patch = { ...patch, targetRevision: findAgent(patch.targetId)?.revision };
        const rows = transfer.rows.map((row, at) => at === index ? { ...row, ...patch } : row).map(row => ({ ...row, preview: undefined }));
        publish({ transfer: { ...transfer, rows }, errors: { ...state.errors, transfer: null } });
      }
      function mapTransferRoute(index, key, patch) {
        const row = state.transfer?.rows[index];
        if (!row || state.transfer.checking || state.busy.changeReceipt) return;
        updateModelTransfer(index, { config: modelTransfer.replaceRoute(row.config, key, patch) });
        const route = modelTransfer.routes(state.transfer.rows[index].config).find(item => item.key === key);
        void loadModelOptions(route.provider);
        void loadModelMetadata(route.provider, route.model);
      }
      function setTransferDefault(index, candidateId) {
        const row = state.transfer?.rows[index];
        if (state.busy.changeReceipt || !row || row.config.model.mode !== 'auto' || !row.config.model.candidates.some(item => item.id === candidateId)) return false;
        updateModelTransfer(index, { config: { ...row.config, model: { ...row.config.model, defaultCandidate: candidateId } } });
        return true;
      }
      function removeTransferRoute(index, key) {
        const row = state.transfer?.rows[index];
        const model = row?.config.model;
        if (state.busy.changeReceipt || !model || model.mode !== 'auto' || model.candidates.length <= 1 || model.defaultCandidate === key || !model.candidates.some(item => item.id === key)) return false;
        updateModelTransfer(index, { config: { ...row.config, model: { ...model, candidates: model.candidates.filter(item => item.id !== key) } } });
        return true;
      }
      function transferIssue(row) {
        if (state.sessionId) return 'transferGlobalOnly';
        const target = findAgent(row.targetId);
        if (!target) return 'transferTargetMissing';
        if (state.transfer.rows.some(other => other !== row && other.selected && other.targetId === row.targetId)) return 'transferDuplicateTarget';
        if (target.source && !target.source.startsWith('user:')) return 'transferSourceOwned';
        if (target.revision !== row.targetRevision) return 'transferChanged';
        if (isDirty(state.drafts[row.targetId])) return 'transferDraftConflict';
        for (const route of modelTransfer.routes(row.config)) {
          if (state.errors.providers) return 'transferUnresolved';
          if (state.providersLoaded && !state.providers.some(item => item.id === route.provider)) return 'transferProviderMissing';
          const metadata = modelMetadataState(route.provider, route.model);
          if (metadata.error || metadata.busy) return 'transferUnresolved';
          const issue = modelTransfer.routeIssue(route, metadata.model);
          if (issue) return issue;
        }
        return '';
      }
      async function checkModelTransfer(force = false) {
        const transfer = state.transfer;
        if (!transfer || transfer.mode !== 'import' || state.sessionId || transfer.checking || state.busy.changeReceipt) return;
        publish({ transfer: { ...transfer, checking: true } });
        try {
          await loadProviders(force);
          const unique = new Map(transfer.rows.flatMap(row => modelTransfer.routes(row.config)).map(route => [metadataKey(route.provider, route.model), route]));
          const entries = [...unique.values()].filter(route => state.providers.some(item => item.id === route.provider));
          let cursor = 0;
          await Promise.all(Array.from({ length: Math.min(8, entries.length) }, async () => {
            while (!disposed && state.transfer?.token === transfer.token && cursor < entries.length) {
              const route = entries[cursor++];
              await Promise.all([loadModelOptions(route.provider, force), loadModelMetadata(route.provider, route.model, force)]);
            }
          }));
        } finally {
          if (state.transfer?.token === transfer.token) publish({ transfer: { ...state.transfer, checking: false } });
        }
      }
      async function previewModelTransfer() {
        const transfer = state.transfer;
        if (!transfer || transfer.mode !== 'import' || transfer.checking || state.sessionId || state.busy.save || state.busy.reset || state.busy.changeReceipt) return false;
        const selected = transfer.rows.filter(row => row.selected);
        if (!selected.length || selected.some(transferIssue)) return false;
        const snapshots = selected.map(row => ({ row, draft: state.drafts[row.targetId], revision: findAgent(row.targetId)?.revision }));
        publish({ transfer: { ...transfer, checking: true, rows: transfer.rows.map(row => ({ ...row, preview: undefined })) }, errors: { ...state.errors, transfer: null } });
        const previews = new Map();
        try {
          for (const snapshot of snapshots) {
            if (state.transfer?.token !== transfer.token || state.sessionId || state.busy.changeReceipt) return false;
            const { row, draft } = snapshot;
            const actions = ['schemaVersion', 'model', 'reasoning'].map(key => ({ path: [key], op: 'set', value: key === 'schemaVersion' ? 3 : row.config[key] }));
            const answer = await request('transfer', 'previewChange', { id: row.targetId, actions, ...(draft?.expectedRevision ? { expectedRevision: draft.expectedRevision } : {}) });
            if (!answer.ok) return false;
            const value = answer.value;
            if (value?.id !== row.targetId || typeof value.text !== 'string' || !validText(value.impactRevision) || !Array.isArray(value.impacts)) { error('transfer', { code: 'malformedResponse', message: 'malformedResponse' }); return false; }
            previews.set(row.id, { value, draft, revision: snapshot.revision, actions });
          }
          if (state.transfer?.token !== transfer.token || state.busy.changeReceipt) return false;
          publish({ transfer: { ...state.transfer, rows: state.transfer.rows.map(row => ({ ...row, preview: previews.get(row.id) })) } });
          return true;
        } finally {
          if (state.transfer?.token === transfer.token) publish({ transfer: { ...state.transfer, checking: false } });
        }
      }
      function adoptModelTransfer() {
        const transfer = state.transfer;
        if (!transfer || transfer.mode !== 'import' || transfer.checking || state.sessionId || state.busy.save || state.busy.reset || state.busy.changeReceipt) return false;
        const rows = transfer.rows.filter(row => row.selected);
        if (!rows.length || rows.some(row => transferIssue(row) || !row.preview || row.preview.draft !== state.drafts[row.targetId] || row.preview.revision !== findAgent(row.targetId)?.revision)) { error('transfer', { code: 'transferChanged', message: 'transferChanged' }); return false; }
        // Check every row before staging any. Saving still requires the normal fresh impact preview/CAS.
        const drafts = { ...state.drafts };
        for (const row of rows) {
          invalidateSuggestion(row.targetId);
          const draft = drafts[row.targetId] || makeDraft(row.targetId);
          drafts[row.targetId] = { ...draft, form: { ...draft.form, ...row.config, schemaVersion: 3 }, actions: row.preview.actions, text: row.preview.value.text, kind: 'form', materialized: true };
        }
        invalidateChange();
        publish({ drafts, selectedId: rows[0].targetId, creating: false, transfer: null, notice: 'transferStaged', preview: null });
        return true;
      }
      async function importText(text) {
        if (state.sessionId) return false;
        if (new TextEncoder().encode(text).length > 1024 * 1024) { error('import', { code: 'importTooLarge', message: 'importTooLarge' }); return false; }
        if (isDirty(state.drafts['@new'])) { error('import', { code: 'draftConflict', message: 'draftConflict' }); return false; }
        invalidateChange();
        publish({ creating: true, imported: true, identity: null, newId: '', notice: 'unsavedImport', drafts: { ...state.drafts, '@new': { baseline: '', form: null, text, kind: 'raw' } }, errors: { ...state.errors, import: null } });
        await inspectNew(text);
        return true;
      }
      function useExistingDocument() {
        if (state.sessionId) return false;
        const draft = state.drafts['@new'], id = state.identity?.id;
        const role = findAgent(id);
        if (!id || state.identity.text !== draft?.text || (!role && !findOverride(id)) || isDirty(state.drafts[id]) || (role?.source && !role.source.startsWith('user:'))) return false;
        invalidateSuggestion(id); invalidateChange();
        const drafts = { ...state.drafts, [id]: { ...makeDraft(id), text: draft.text, kind: 'raw' } };
        delete drafts['@new'];
        publish({ drafts, creating: false, selectedId: id, notice: 'unsavedImport', preview: null });
        return true;
      }
      async function save(id) {
        if (!canEdit(id)) return { ok: false };
        if (state.busy.save || state.busy.reset || state.busy.changeReceipt) return { ok: false };
        const key = id === '@new' ? '@new' : id;
        const draft = state.drafts[key];
        if (!draft) return { ok: false };
        if (key === '@new' && state.identity?.text !== draft.text) {
          const parsed = await inspectNew(draft.text);
          if (!parsed.ok || state.drafts[key]?.text !== draft.text) return parsed.ok ? { ok: false, aborted: true } : parsed;
        }
        const targetId = key === '@new' ? state.identity?.id : id;
        if (!targetId) { error('save', { code: 'invalidId', message: 'invalidId' }); return { ok: false }; }
        if (key === '@new' && (findAgent(targetId) || findOverride(targetId))) {
          error('save', { code: 'duplicateId', message: 'duplicateId' }); return { ok: false };
        }
        const issues = draft.kind === 'form' ? formIssues(draft.form) : [];
        if (issues.length) { error('save', { code: 'invalidForm', message: 'invalidForm', details: { issues } }); return { ok: false }; }
        if (!canEdit(key)) return { ok: false };
        if (findOverride(targetId) && !draft.expectedRevision) {
          error('save', { code: 'missingRevision', message: 'missingRevision' }); return { ok: false };
        }
        const input = changeRequestFor(key, false, targetId);
        let preview = state.changePreview?.key === input.key ? state.changePreview : null;
        if (!preview) {
          const checked = await previewChange(key, false, targetId);
          if (!checked.ok) return checked;
          preview = state.changePreview?.key === input.key ? state.changePreview : null;
          if (!preview) return { ok: false };
        }
        const impacts = (preview.impacts || []).filter(impact => impact.requiresAcceptance !== false);
        if (impacts.some(impact => state.changeAccepted[impact.id] !== true)) return { ok: false, needsAcceptance: true, value: preview };
        const text = preview.text;
        const { actions: _actions, baseText: _baseText, ...bound } = input.request;
        const payload = { ...bound, text, impactRevision: preview.impactRevision, acceptedIndirectRoles: impacts.map(impact => impact.id) };
        const accept = (value, notice = 'saved') => {
          if (value?.text !== text || !validText(value.revision)) throw { code: 'malformedResponse', message: 'malformedResponse' };
          const current = state.drafts[key];
          const unchanged = current?.actions === draft.actions && current?.text === text;
          const saved = { ...current, baseline: value.text, expectedRevision: value.revision, ...(unchanged ? { text: value.text, actions: [], formBaseText: undefined, kind: 'raw' } : {}) };
          const drafts = { ...state.drafts, [targetId]: saved };
          if (key === '@new' && unchanged) delete drafts['@new'];
          publish({ drafts, changePreview: null, changeAccepted: {}, ...(key === '@new' && unchanged ? { creating: false, selectedId: targetId } : {}), notice });
        };
        const answer = await request('save', 'save', payload, accept);
        if (answer.error?.code.startsWith('AGENTDECK_IMPACT_')) invalidateChange();
        if (answer.uncertain) return readChangeReceipt('save', payload, stored => {
          if (stored?.text !== text || !validText(stored.revision)) return false;
          accept(stored, 'changeObserved');
          return true;
        });
        if (answer.ok && !disposed) await loadCatalog();
        return answer;
      }
      async function reset(id) {
        if (!canEdit(id)) return { ok: false };
        if (state.busy.save || state.busy.reset || state.busy.changeReceipt) return { ok: false };
        const draft = state.drafts[id];
        if (!draft?.expectedRevision) { error('reset', { code: 'missingRevision', message: 'missingRevision' }); return { ok: false }; }
        const input = changeRequestFor(id, true, id);
        let preview = state.changePreview?.key === input.key ? state.changePreview : null;
        if (!preview) {
          const checked = await previewChange(id, true, id);
          if (!checked.ok) return checked;
          preview = state.changePreview?.key === input.key ? state.changePreview : null;
          if (!preview) return { ok: false };
        }
        const impacts = (preview.impacts || []).filter(impact => impact.requiresAcceptance !== false);
        if (impacts.some(impact => state.changeAccepted[impact.id] !== true)) return { ok: false, needsAcceptance: true, value: preview };
        const { reset: _reset, ...bound } = input.request;
        const payload = { ...bound, impactRevision: preview.impactRevision, acceptedIndirectRoles: impacts.map(impact => impact.id) };
        const accept = notice => {
          const drafts = { ...state.drafts };
          if (drafts[id] === draft) delete drafts[id];
          publish({ drafts, changePreview: null, changeAccepted: {}, notice, preview: null });
        };
        const answer = await request('reset', 'reset', payload, value => {
          if (value?.id !== id || value.reset !== true) throw { code: 'malformedResponse', message: 'malformedResponse' };
          accept('resetDone');
        });
        if (answer.error?.code.startsWith('AGENTDECK_IMPACT_')) invalidateChange();
        if (answer.uncertain) return readChangeReceipt('reset', payload, (stored, catalog) => {
          if ((preview.project && catalog.project !== preview.project) || stored) return false;
          accept('changeObserved');
          return true;
        });
        if (answer.ok && !disposed) await loadCatalog();
        return answer;
      }
      async function readChangeReceipt(kind, payload, observe) {
        invalidateChange();
        const scope = payload.sessionId ? { sessionId: payload.sessionId } : {};
        let observed = false;
        await request('changeReceipt', 'catalog', scope, catalog => {
          observed = observe(catalog.overrides.find(item => item.id === payload.id), catalog);
        });
        if (observed) {
          error(kind, null);
          await loadCatalog();
        } else {
          error(kind, { code: 'changeOutcomeUnknown', message: 'changeOutcomeUnknown' });
        }
        return { ok: false, observed, uncertain: !observed };
      }
      function discard(id) {
        invalidateSuggestion(id); invalidateChange();
        const writeSessionId = canEdit(id) ? state.drafts[id]?.writeSessionId : undefined;
        publish({ drafts: { ...state.drafts, [id]: { ...makeDraft(id), writeSessionId } }, errors: { ...state.errors, save: null, reset: null }, notice: '' });
      }
      function acceptProviders(value) {
        publish({ providers: value.providers, providersLoaded: true });
      }
      const suggestionModelsKey = provider => 'suggestionModels:' + JSON.stringify(provider);
      function suggestionModelOptionsState(provider = '') {
        const key = suggestionModelsKey(provider);
        const loaded = Object.hasOwn(state.suggestionModelOptions, provider);
        return { items: loaded ? state.suggestionModelOptions[provider] : [], loaded, busy: Boolean(state.busy[key]), error: state.errors[key] || null };
      }
      function loadSuggestionModelOptions(provider = '', force = false) {
        const key = suggestionModelsKey(provider);
        if (!force && suggestionModelReads.has(key)) return suggestionModelReads.get(key);
        if (!force && suggestionModelOptionsState(provider).loaded) return Promise.resolve({ ok: true });
        const work = request(key, 'models', { view: 'setup-options', ...(provider ? { provider } : {}) }, value => {
          if (value.diagnostics?.length) throw { code: 'modelOptionsUnavailable', message: value.diagnostics.join('\n'), details: { provider, diagnostics: value.diagnostics } };
          const items = provider ? value.models : value.providers;
          if (!Array.isArray(items)) throw { code: 'malformedResponse', message: 'malformedResponse' };
          publish({ suggestionModelOptions: { ...state.suggestionModelOptions, [provider]: items } });
        });
        suggestionModelReads.set(key, work);
        void work.then(() => { if (suggestionModelReads.get(key) === work) suggestionModelReads.delete(key); });
        return work;
      }
      function cancelSuggestionModels() {
        suggestionModelReads.clear();
        const busy = { ...state.busy };
        for (const [key, controller] of requests) {
          if (key.startsWith('suggestionModels:')) { controller.abort(); requests.delete(key); busy[key] = false; }
        }
        publish({ busy });
      }
      function loadProviders(force = false) {
        if (!force && state.providersLoaded) return Promise.resolve({ ok: true });
        if (!force && providersRead) return providersRead;
        const work = request('providers', 'models', { ...sessionPayload(), view: 'options' }, acceptProviders);
        providersRead = work;
        void work.then(() => { if (providersRead === work) providersRead = undefined; });
        return work;
      }
      function modelOptionsState(provider) {
        const key = optionsKey(provider);
        return { items: state.modelOptions[provider] || [], loaded: Object.hasOwn(state.modelOptions, provider), busy: Boolean(state.busy[key]), error: state.errors[key] || null };
      }
      function loadModelOptions(provider, force = false) {
        if (!provider) return loadProviders(force);
        if (!force && providerLists.has(provider)) return providerLists.get(provider);
        if (!force && Object.hasOwn(state.modelOptions, provider)) return Promise.resolve({ ok: true });
        const work = request(optionsKey(provider), 'models', { ...sessionPayload(), view: 'options', provider }, value => {
          acceptProviders(value);
          if (value.diagnostics?.length) throw { code: 'modelOptionsUnavailable', message: value.diagnostics.join('\n'), details: { provider, diagnostics: value.diagnostics } };
          publish({ modelOptions: { ...state.modelOptions, [provider]: value.models } });
        });
        providerLists.set(provider, work);
        void work.then(() => { if (providerLists.get(provider) === work) providerLists.delete(provider); });
        return work;
      }
      function modelMetadataState(provider, model) {
        const key = metadataKey(provider, model);
        const preview = state.preview?.model;
        const cached = state.modelMetadata[key];
        const row = cached?.models?.find(item => item.provider === provider && item.id === model);
        const matchingPreview = preview?.provider === provider && preview?.id === model && preview?.metadataResolved;
        return { model: row?.metadataResolved ? row : matchingPreview ? preview : row, value: cached, busy: Boolean(state.busy[key]), error: state.errors[key] || null };
      }
      function loadModelMetadata(provider, model, force = false) {
        if (!provider || !model) return Promise.resolve({ ok: false });
        const key = metadataKey(provider, model);
        if (!force && exactModels.has(key)) return exactModels.get(key);
        if (!force && modelMetadataState(provider, model).model?.metadataResolved) return Promise.resolve({ ok: true, value: state.modelMetadata[key] });
        const work = request(key, 'models', { ...sessionPayload(), view: 'options', provider, model }, value => {
          acceptProviders(value);
          publish({ modelMetadata: { ...state.modelMetadata, [key]: value } });
        });
        exactModels.set(key, work);
        void work.then(() => { if (exactModels.get(key) === work) exactModels.delete(key); });
        return work;
      }
      function editableCandidate(id, index) {
        const draft = state.drafts[id];
        return draft?.form?.model?.mode === 'auto' && !(isDirty(draft) && draft.kind === 'raw') ? draft.form.model.candidates[index] : undefined;
      }
      function loadCandidateOptions(id, index, force = false) {
        const candidate = editableCandidate(id, index);
        return candidate ? loadModelOptions(candidate.provider, force) : Promise.resolve({ ok: false });
      }
      function loadCandidateMetadata(id, index, force = false) {
        const candidate = editableCandidate(id, index);
        return candidate ? loadModelMetadata(candidate.provider, candidate.model, force) : Promise.resolve({ ok: false });
      }
      function setCandidateProvider(id, index, provider) {
        if (!editableCandidate(id, index)) return Promise.resolve({ ok: false });
        updateCandidate(id, index, { provider, model: '', reasoning: { mode: 'model-default' } });
        return loadModelOptions(provider);
      }
      function setCandidateModel(id, index, model) {
        if (!editableCandidate(id, index)) return Promise.resolve({ ok: false });
        updateCandidate(id, index, { model, reasoning: { mode: 'model-default' } });
        return loadCandidateMetadata(id, index);
      }
      function cancelModelReads() {
        modelGeneration++;
        providerLists.clear(); exactModels.clear(); providersRead = undefined;
        const busy = { ...state.busy };
        for (const [key, controller] of requests) {
          if (key === 'providers' || key.startsWith('modelOptions:') || key.startsWith('modelMetadata:')) { controller.abort(); requests.delete(key); busy[key] = false; }
        }
        publish({ busy });
      }
      async function loadModels(provider, model) {
        if (!provider || !model) return loadModelOptions(provider, true);
        const generation = ++modelGeneration;
        const exact = loadModelMetadata(provider, model, true);
        void loadModelOptions(provider);
        const answer = await exact;
        if (answer.ok && !disposed && generation === modelGeneration) publish({ models: answer.value });
        return answer;
      }
      function previewCandidate(id) {
        const model = findAgent(id)?.model;
        return model?.mode === 'auto' ? (model.candidates.some(item => item.id === state.previewCandidates[id]) ? state.previewCandidates[id] : model.defaultCandidate) : undefined;
      }
      function loadPreview(id, candidateId = previewCandidate(id), revision = findAgent(id)?.revision) {
        const context = state.sessionId;
        const evidence = { ...state.evidence }; delete evidence[id];
        publish({ preview: null, evidence });
        return request('preview', 'preview', { id, ...sessionPayload(), ...(revision ? { revision } : {}), ...(candidateId ? { candidateId } : {}) }, preview => {
          if (context !== state.sessionId || revision !== findAgent(id)?.revision) return;
          publish({ preview, evidence: { ...state.evidence, [id]: { context, candidateId, preview } } });
        });
      }
      function syncReads(force = false) {
        if (refreshing || !state.catalog || disposed) return Promise.resolve([]);
        if (state.tab !== 'roles') {
          cancelModelReads();
          cancelSuggestionModels();
          requests.get('preview')?.abort(); requests.delete('preview');
          modelReadKey = previewReadKey = undefined;
          publish({ busy: { ...state.busy, preview: false } });
          return state.tab === 'runs' && (force || state.runs === null && !state.busy.runs && !state.errors.runs) ? Promise.all([api.loadRuns()]) : Promise.resolve([]);
        }
        const reads = [];
        const agent = findAgent(state.selectedId);
        if (agent) {
          const previewKey = JSON.stringify([state.sessionId, agent.id, agent.revision, previewCandidate(agent.id)]);
          if (force || previewReadKey !== previewKey) { previewReadKey = previewKey; reads.push(loadPreview(agent.id)); }
          const mode = state.drafts[agent.id]?.form?.model || agent.model;
          const modelKey = mode?.mode === 'fixed' ? JSON.stringify([state.sessionId, mode.provider, mode.model]) : mode?.mode || 'inherit';
          if (mode?.mode === 'fixed' && (force || modelReadKey !== modelKey)) {
            modelReadKey = modelKey;
            reads.push(loadModels(mode.provider, mode.model));
          } else if (mode?.mode !== 'fixed' && modelReadKey !== modelKey) {
            modelReadKey = modelKey;
            cancelModelReads();
            publish({ models: null });
          }
        }
        return Promise.all(reads);
      }
      async function refresh() {
        refreshing = true;
        cancelModelReads();
        cancelSuggestionModels();
        requests.get('preview')?.abort(); requests.delete('preview');
        publish({ preview: null, evidence: {}, busy: { ...state.busy, preview: false }, models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, suggestionModelOptions: {} });
        try {
          const answer = await loadCatalog();
          if (answer.ok && !disposed) {
          refreshing = false;
          await syncReads(true);
        }
          return answer;
        } finally { refreshing = false; }
      }
      function setSession(sessionId) {
        if (sessionId === state.sessionId) return;
        invalidateChange();
        cancelModelReads();
        modelReadKey = previewReadKey = undefined;
        for (const key of ['catalog', 'preview']) { requests.get(key)?.abort(); requests.delete(key); }
        publish({ sessionId, transfer: null, catalog: null, evidence: {}, models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, preview: null, errors: { ...state.errors, catalog: null, preview: null, models: null }, busy: { ...state.busy, catalog: false, preview: false } });
      }
      function invalidateChange() {
        requests.get('changePreview')?.abort(); requests.delete('changePreview');
        publish({ changePreview: null, changeAccepted: {}, errors: { ...state.errors, changePreview: null }, busy: { ...state.busy, changePreview: false } });
      }
      function changeRequestFor(draftId, reset = false, targetId = draftId) {
        const draft = state.drafts[draftId];
        const scope = draft?.writeSessionId ? { sessionId: draft.writeSessionId } : {};
        const request = { ...scope, id: targetId, ...(reset ? { reset: true } : draft?.kind === 'form' && draft.actions?.length ? { actions: draft.actions, ...(draft.formBaseText === undefined ? {} : { baseText: draft.formBaseText }) } : { text: draft?.text }), ...(draft?.expectedRevision ? { expectedRevision: draft.expectedRevision } : {}) };
        return { request, key: JSON.stringify(request) };
      }
      async function previewChange(draftId, reset = false, targetId = draftId) {
        if (!canEdit(draftId)) return { ok: false };
        const { request: input, key } = changeRequestFor(draftId, reset, targetId);
        if (!input.id || (!reset && !input.text && !input.actions)) return { ok: false };
        return request('changePreview', 'previewChange', input, value => {
          if (key !== changeRequestFor(draftId, reset, targetId).key) return;
          if (value?.id !== targetId || !validText(value.impactRevision) || !Array.isArray(value.impacts) || (reset ? value.reset !== true : typeof value.text !== 'string')) throw { code: 'malformedResponse', message: 'malformedResponse' };
          const draft = state.drafts[draftId];
          const drafts = draft?.kind === 'form' && typeof value.text === 'string' ? { ...state.drafts, [draftId]: { ...draft, text: value.text, materialized: true } } : state.drafts;
          publish({ drafts, changePreview: { ...value, key, id: targetId, draftId, reset }, changeAccepted: {}, errors: { ...state.errors, changePreview: null } });
        });
      }
      async function materializeDraft(id) {
        const draft = state.drafts[id];
        if (!draft) return undefined;
        if (!draft.actions?.length || draft.materialized) return draft.text;
        const answer = await previewChange(id);
        return answer.ok && state.drafts[id]?.materialized ? state.drafts[id].text : undefined;
      }
      function acceptChangeImpact(id, checked) {
        if (state.changePreview?.impacts?.some(item => item.id === id)) publish({ changeAccepted: { ...state.changeAccepted, [id]: checked } });
      }
      function setRunParent(parentId) {
        requests.get('runs')?.abort(); requests.delete('runs');
        api.closeResult();
        publish({ runParentId: parentId, runs: null, runCursor: null, busy: { ...state.busy, runs: false }, errors: { ...state.errors, runs: null } });
      }
      const suggestionKey = id => JSON.stringify([state.drafts[id]?.form, state.drafts[id]?.text, state.drafts[id]?.kind, findAgent(id)?.revision, state.suggestions[id]?.generator, state.suggestions[id]?.requirements || '', state.suggestions[id]?.candidatePlan || 'auto']);
      function invalidateSuggestion(id) {
        const key = 'suggest:' + id;
        requests.get(key)?.abort(); requests.delete(key);
        publish({ busy: { ...state.busy, [key]: false } });
      }
      function updateSuggestion(id, patch) {
        invalidateSuggestion(id);
        const previous = Object.hasOwn(state.suggestions, id) ? state.suggestions[id] : { generator: { provider: '', model: '' }, requirements: '', candidatePlan: 'auto' };
        publish({ suggestions: { ...state.suggestions, [id]: { ...previous, ...patch } } });
      }
      function openSuggestion(id) {
        const previous = state.suggestions[id] || { generator: { provider: '', model: '' }, requirements: '', candidatePlan: 'auto' };
        const generator = previous.generator || { provider: '', model: '' };
        updateSuggestion(id, { open: true, candidatePlan: previous.candidatePlan || 'auto' });
        void loadSuggestionModelOptions();
        if (generator.provider) void loadSuggestionModelOptions(generator.provider);
      }
      function suggestionCurrent(id) {
        const suggestion = state.suggestions[id];
        return Boolean(suggestion?.result && suggestion.sourceKey === suggestionKey(id));
      }
      async function generateSuggestion(id) {
        const draft = state.drafts[id], options = state.suggestions[id];
        if (!draft?.form || !['fixed', 'auto'].includes(draft.form.model.mode) || isDirty(draft) && draft.kind === 'raw' || !options?.generator?.provider || !options.generator.model) return { ok: false };
        const sourceKey = suggestionKey(id);
        return request('suggest:' + id, 'suggest', { version: 1, id, ...sessionPayload(), definition: draft.form, generator: options.generator, requirements: options.requirements,
          ...(draft.form.model.mode === 'auto' ? { candidatePlan: options.candidatePlan || 'auto' } : {}), revision: findAgent(id)?.revision }, value => {
          if (sourceKey !== suggestionKey(id)) return;
          if (value?.id !== id || value.mode !== draft.form.model.mode || !value.model || !value.reasoning || typeof value.reason !== 'string') throw { code: 'malformedResponse', message: 'malformedResponse' };
          publish({ suggestions: { ...state.suggestions, [id]: { ...state.suggestions[id], result: value, sourceKey, adopted: false, before: { model: draft.form.model, reasoning: draft.form.reasoning } } } });
        }, 120000);
      }
      function adoptSuggestion(id) {
        const draft = state.drafts[id];
        if (!suggestionCurrent(id) || !canEdit(id) || !draft?.form || isDirty(draft) && draft.kind === 'raw' || state.busy['suggest:' + id]) return false;
        const result = state.suggestions[id].result;
        updateForm(id, { model: result.model, reasoning: result.reasoning });
        publish({ suggestions: { ...state.suggestions, [id]: { ...state.suggestions[id], adopted: true } } });
        return true;
      }
      const clearRunEvidence = childId => state.runs?.map(run => run.childId === childId
        ? { ...run, businessStatus: undefined, businessStatusCheckedAt: undefined } : run) ?? null;
      const api = {
        getSnapshot: () => state,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        activate: () => { disposed = false; },
        dispose: () => { disposed = true; modelGeneration++; for (const controller of requests.values()) controller.abort(); requests.clear(); listeners.clear(); },
        isDisposed: () => disposed,
        set: publish, error, openModelExport, exportModels, importModels, updateModelTransfer, mapTransferRoute, setTransferDefault, removeTransferRoute, transferIssue, checkModelTransfer, previewModelTransfer, adoptModelTransfer, openForm, restoreField, loadModelMetadata, loadCatalog, select, canEdit, useProjectEdit, edit, updateForm, setModelMode, updateCandidate, addCandidate, removeCandidate, selectPreviewCandidate, beginCreate, setNewId, setNewBase, importText, useExistingDocument, materializeDraft, save, reset, discard, setSession,
        loadModels, loadProviders, loadSuggestionModelOptions, suggestionModelOptionsState, loadModelOptions, modelOptionsState, modelMetadataState, loadCandidateOptions, loadCandidateMetadata, setCandidateProvider, setCandidateModel, loadPreview, syncReads, refresh, previewChange, acceptChangeImpact, setRunParent, openSuggestion, updateSuggestion, generateSuggestion, adoptSuggestion, suggestionCurrent,
        captureWorkspaceCuts: () => {
          if (!state.catalog?.runtime?.canCaptureWorkspaceCuts || state.busy.workspaceCapture) return;
          publish({ workspaceCapture: null });
          return request('workspaceCapture', 'captureWorkspaceCuts', {}, value => publish({ workspaceCapture: value }));
        },
        loadRuns: (more = false) => {
          const cursor = more && state.runCursor;
          if (!cursor) api.closeResult();
          return request('runs', 'runs', { ...runSessionPayload(), ...(cursor ? { cursor } : {}) }, value => publish({ runCursor: value.nextCursor, runs: cursor ? [...state.runs, ...value.runs] : value.runs, runParents: value.parentIds || state.runParents }));
        },
        closeResult: () => { requests.get('result')?.abort(); requests.delete('result'); publish({ result: null, resultChild: '', resultStale: false, busy: { ...state.busy, result: false }, errors: { ...state.errors, result: null } }); },
        loadResult(childId, more = false) {
          const previous = state.resultChild === childId ? state.result : null;
          const continuation = more && !state.resultStale && previous?.nextOffset !== undefined;
          publish({ resultChild: childId, result: previous, resultStale: !continuation && Boolean(previous),
            ...(!continuation ? { runs: clearRunEvidence(childId) } : {}) });
          return request('result', 'result', { childId, offset: continuation ? previous.nextOffset : 0, limit: 12000,
            ...(continuation ? { resultRevision: previous.resultRevision } : {}) }, value => {
            if (continuation && (!previous.resultRevision || value.resultRevision !== previous.resultRevision)) throw { code: 'AGENTDECK_RESULT_CHANGED', message: 'Result revision is missing or changed. Reload the first page.' };
            const result = continuation ? { ...value, rawText: previous.rawText + value.rawText, nativeStopPage: previous.nativeStopPage } : value;
            const runs = state.runs?.map(run => run.childId === childId ? { ...run, businessStatus: result.status, businessStatusCheckedAt: continuation ? run.businessStatusCheckedAt : new Date().toISOString() } : run) ?? null;
            publish({ result, resultStale: false, runs });
          });
        },
        loadNativeStop(childId) {
          const result = state.result;
          if (state.resultChild !== childId || state.resultStale || state.busy.result || !result?.nativeStopTruncated || !result.resultRevision) return;
          const previous = result.nativeStopPage;
          if (previous && previous.nextOffset === undefined) return;
          return request('result', 'result', { childId, section: 'nativeStop', offset: previous?.nextOffset ?? 0, limit: 12000, resultRevision: result.resultRevision }, value => {
            if (value.resultRevision !== result.resultRevision) throw { code: 'AGENTDECK_RESULT_CHANGED', message: 'Result revision is missing or changed. Reload the first page.' };
            publish({ result: { ...result, nativeStopPage: { ...value, rawText: (previous?.rawText ?? '') + value.rawText } } });
          });
        }
      };
      return api;
    }

    function enumText(value, t) { return value && dictionaries.en['status.' + value] ? t('status.' + value) : value || t('unknown'); }
    function businessStatus(run) { return run.businessStatus || (run.phase === 'failed' ? 'failed' : run.phase === 'accepted' ? 'unverified' : 'pending'); }
    const css = `
.ad-root{width:100%;max-width:920px;min-width:0;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:1.55;container:agentdeck / inline-size}
.ad-root *{box-sizing:border-box}.ad-root h2,.ad-root h3,.ad-root h4,.ad-root p{margin:0}.ad-root h2{font-size:20px;font-weight:600;line-height:1.4}.ad-root h3{font-size:16px;font-weight:600}.ad-root h4{font-size:13px;font-weight:600}.ad-root button,.ad-root input,.ad-root select,.ad-root textarea{font:inherit;color:inherit}.ad-root button{cursor:pointer}.ad-root button:disabled{cursor:default;opacity:.5}.ad-root :is(button,input,select,textarea,summary):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.ad-root ::selection{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base)}
.ad-root input,.ad-root select,.ad-root textarea{width:100%;min-width:0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:7px 10px;caret-color:var(--dsw-alias-brand-primary)}.ad-root input::placeholder,.ad-root textarea::placeholder{color:var(--dsw-alias-label-secondary)}.ad-root input[type=checkbox]{width:18px;height:18px;accent-color:var(--dsw-alias-brand-primary)}.ad-root select{min-height:36px}.ad-root textarea{resize:vertical}.ad-root pre,.ad-root code,.ad-yaml{font-family:var(--ds-font-family-code,monospace);font-size:12px}.ad-root pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;line-height:1.6}.ad-root code{overflow-wrap:anywhere}.ad-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:20px}.ad-muted,.ad-help{color:var(--dsw-alias-label-secondary)}.ad-help{font-size:12px;line-height:1.6}.ad-intro{margin-top:4px!important}.ad-btn{display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:6px 12px;gap:6px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);white-space:nowrap}.ad-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.ad-primary{background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-base)!important;border-color:var(--dsw-alias-label-primary)}.ad-primary:hover:not(:disabled){background:var(--dsw-alias-label-secondary)}.ad-danger{color:var(--dsw-alias-state-error-primary)!important}.ad-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ad-tabs{display:flex;gap:18px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:20px}.ad-tab{border:0;border-bottom:2px solid transparent;background:transparent;padding:8px 0 10px;color:var(--dsw-alias-label-secondary)!important}.ad-tab[aria-selected=true]{color:var(--dsw-alias-label-primary)!important;border-bottom-color:var(--dsw-alias-label-primary)}.ad-session{display:grid;grid-template-columns:150px minmax(0,1fr);align-items:start;gap:12px;margin-bottom:20px}.ad-session label{padding-top:7px;font-weight:500}.ad-stack{display:flex;flex-direction:column;gap:10px}.ad-layout{display:grid;grid-template-columns:210px minmax(0,1fr);gap:24px;align-items:start}.ad-sidebar{min-width:0}.ad-search{margin-bottom:8px}.ad-role-list{list-style:none;padding:0;margin:10px 0 0;max-height:620px;overflow:auto}.ad-role{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--dsw-alias-border-l1);background:transparent;padding:11px 8px;border-radius:6px}.ad-role:hover{background:var(--dsw-alias-bg-layer-1)}.ad-role[aria-current=true]{background:var(--dsw-alias-bg-layer-2)}.ad-role-name{font-weight:500;display:block}.ad-role-meta{color:var(--dsw-alias-label-secondary);font-size:12px;display:flex;gap:8px;flex-wrap:wrap;margin-top:3px}.ad-detail{min-width:0}.ad-detail-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}.ad-detail-desc{margin:6px 0 12px!important;color:var(--dsw-alias-label-secondary);max-width:70ch}.ad-tags{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.ad-tag{display:inline-block;padding:2px 7px;border:1px solid var(--dsw-alias-border-l1);border-radius:5px;color:var(--dsw-alias-label-secondary);font-size:12px}.ad-status{color:var(--dsw-alias-state-success-primary)}.ad-warning{color:var(--dsw-alias-state-warn-primary)}.ad-idle{color:var(--dsw-alias-state-idle-primary)}.ad-section{border-top:1px solid var(--dsw-alias-border-l1);padding-top:20px;margin-top:20px}.ad-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-top:12px}.ad-field{display:flex;flex-direction:column;gap:5px;min-width:0}.ad-field>span:first-child{font-weight:500}.ad-check{display:flex;align-items:center;gap:8px;min-height:34px}.ad-stats{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px 20px;margin:12px 0 0}.ad-stats>div{min-width:0}.ad-stats dt{color:var(--dsw-alias-label-secondary);font-size:12px}.ad-stats dd{margin:1px 0 0;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}.ad-alert{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:10px 12px;margin:12px 0;overflow-wrap:anywhere}.ad-error{color:var(--dsw-alias-state-error-primary)}.ad-notice{color:var(--dsw-alias-state-success-primary);margin:10px 0!important}.ad-empty{padding:24px 0;color:var(--dsw-alias-label-secondary)}.ad-yaml{min-height:260px;tab-size:2;line-height:1.6;margin-top:8px}.ad-savebar{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:12px}.ad-inline-confirm{margin-top:10px;padding:12px;background:var(--dsw-alias-bg-layer-1);border-radius:8px}.ad-inline-confirm p{margin-bottom:10px}.ad-details{margin-top:12px}.ad-details summary{cursor:pointer;padding:5px 0;font-weight:500}.ad-details pre{margin-top:8px}.ad-list{padding-left:18px;margin:8px 0}.ad-list li{margin:5px 0;overflow-wrap:anywhere}.ad-run{padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}.ad-run-title{font-weight:500;overflow-wrap:anywhere}.ad-run-meta{display:flex;gap:8px 16px;flex-wrap:wrap;margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:12px}.ad-run-actions{margin-top:10px}.ad-result{padding:16px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;margin-top:16px}.ad-result .ad-section{margin-top:16px;padding-top:16px}.ad-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}.ad-new{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.ad-candidates{margin-top:14px}.ad-candidate{border:0;border-top:1px solid var(--dsw-alias-border-l1);padding:12px 0 16px;margin:16px 0 0;min-width:0}.ad-candidate legend{font-weight:500;padding-right:8px}.ad-candidate .ad-fields{margin-top:0;margin-bottom:10px}.ad-suggestion-launch{display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--dsw-alias-border-l1);padding:16px 0 4px;margin-top:16px}.ad-suggestion-launch-copy{min-width:0}.ad-suggestion-panel{border-top:1px solid var(--dsw-alias-border-l1);padding:16px 0 4px;margin-top:16px}.ad-suggestion-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.ad-suggestion-head h4{margin-bottom:3px}
@container agentdeck (max-width:640px){.ad-layout{grid-template-columns:minmax(0,1fr);gap:20px}.ad-role-list{max-height:220px}.ad-session{grid-template-columns:minmax(0,1fr);gap:5px}.ad-session label{padding:0}.ad-head{gap:10px}.ad-tabs{gap:16px}.ad-fields{grid-template-columns:minmax(0,1fr)}.ad-detail-head{flex-wrap:wrap}.ad-stats{gap:10px}.ad-root h2{font-size:18px}}
@media(pointer:coarse){.ad-btn,.ad-tab,.ad-role,.ad-root select{min-height:44px}.ad-root input,.ad-root select,.ad-root textarea{font-size:16px}.ad-actions{gap:8px}}`;

    function DeckIcon({ size = 20 }) {
      return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
        h('path', { d: 'M5 8V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3' }),
        h('rect', { x: 3, y: 8, width: 13, height: 13, rx: 2 }),
        h('path', { d: 'M7 12h5M7 16h3' }));
    }
    function Field({ label, children, help }) {
      return h('label', { className: 'ad-field' }, h('span', null, label), children, help && h('span', { className: 'ad-help' }, help));
    }
    function Button({ children, primary, danger, buttonRef, ...props }) {
      return h('button', { type: 'button', ref: buttonRef, ...props, className: 'ad-btn' + (primary ? ' ad-primary' : '') + (danger ? ' ad-danger' : '') }, children);
    }
    function Stats({ rows }) {
      return h('dl', { className: 'ad-stats' }, rows.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))));
    }
    function ErrorNotice({ value, t, save, retry }) {
      if (!value) return null;
      const known = dictionaries.en[value.message] || dictionaries.en[value.code];
      const message = known ? t(dictionaries.en[value.message] ? value.message : value.code) : value.message || t('requestFailed');
      const details = value.details;
      return h('div', { className: 'ad-alert ad-error', role: 'alert' },
        save && h('p', null, t('saveError')), h('p', null, message),
        details?.stage && h('p', null, t('suggestFailureStage', { stage: t('suggest.stage.' + details.stage), route: [details.provider, details.model].filter(Boolean).join(' / ') })),
        value.code && !dictionaries.en[value.code] && h('code', null, value.code),
        details && h(CodeDetail, { title: t('errorDetails'), value: details }),
        retry && h(Button, { onClick: retry }, t('retry')));
    }
    function DiagnosticList({ items, t }) {
      if (!items?.length) return null;
      return h('ul', { className: 'ad-list ad-warning' }, items.map((item, index) => h('li', { key: index }, typeof item !== 'string' && dictionaries.en[item.code] ? h(React.Fragment, null, t(item.code, item.params), item.original && h(CodeDetail, { title: t('originalDiagnostic'), value: item.original })) : typeof item === 'string' ? item : [item.id, item.source, item.message].filter(Boolean).join(' · '))));
    }
    function CodeDetail({ title, value }) {
      if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return null;
      return h('details', { className: 'ad-details' }, h('summary', null, title), h('pre', null, typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
    }
    function ModelControls({ state, controller, agent, draft, t }) {
      const form = draft?.form;
      const locked = !controller.canEdit(agent.id) || !form || (isDirty(draft) && draft.kind === 'raw');
      const disabled = locked || state.busy.save;
      const model = form?.model || agent.model;
      const reasoning = form?.reasoning || agent.reasoning;
      const models = state.models;
      const fixed = model.mode === 'fixed';
      const auto = model.mode === 'auto';
      const cached = state.evidence[agent.id];
      const candidateId = state.previewCandidates[agent.id] || agent.model.defaultCandidate;
      const value = state.preview || (cached?.context === state.sessionId && cached.candidateId === candidateId ? cached.preview : null);
      const preview = value?.agent.id === agent.id && value.agent.revision === agent.revision ? value : undefined;
      const facts = previewFacts(preview, state.sessionId);
      const route = fixed ? model : facts.configuredSelection || facts.effectiveSelection;
      const previewMatches = preview?.model?.provider === route?.provider && preview?.model?.id === route?.model;
      const metadata = controller.modelMetadataState(model.provider, model.model);
      const exact = fixed ? metadata.model || (previewMatches ? preview.model : undefined) : preview?.model;
      const providers = state.providers;
      const optionState = controller.modelOptionsState(model.provider);
      const options = optionState.items;
      const optionLabel = item => { const value = optionText(item.name, item.id); return item.availability ? t(item.availability === 'unavailable' ? 'unavailableOption' : 'uncheckedOption', { value }) : value; };
      const providerOptions = selected => selectionOptions(selected, providers, state.providersLoaded).map(item => h('option', { key: item.id, value: item.id }, optionLabel(item)));
      const set = patch => controller.updateForm(agent.id, patch);
      const field = name => ({ id: 'agentdeck-' + agent.id + '-' + name, name });
      const authorization = !state.sessionId ? 'unknown' : previewMatches ? facts.authorization.status : exact?.authorized === true ? 'authorized' : exact?.authorized === false ? 'denied' : 'unknown';
      const savedCandidates = agent.model.mode === 'auto' ? agent.model.candidates : [];
      const selectedCandidate = savedCandidates.some(item => item.id === state.previewCandidates[agent.id]) ? state.previewCandidates[agent.id] : agent.model.defaultCandidate;
      const issues = draft.kind === 'form' ? formIssues(form) : [];
      return h('section', { className: 'ad-section', 'aria-label': t('model') },
        h('h4', null, t('model')),
        isDirty(draft) && draft.kind === 'raw' && h('p', { className: 'ad-help ad-warning' }, t('yamlLocked')),
        h('div', { className: 'ad-fields' },
          h(Field, { label: t('modelMode') }, h('select', { ...field('model-mode'), value: model.mode, disabled, onChange: event => controller.setModelMode(agent.id, event.target.value) }, h('option', { value: 'inherit' }, t('inherit')), h('option', { value: 'fixed' }, t('fixed')), h('option', { value: 'auto' }, t('auto')))),
          fixed && h(Field, { label: t('provider') }, h('select', { ...field('provider'), value: model.provider || '', disabled, onFocus: () => controller.loadProviders(), onChange: event => set({ model: { mode: 'fixed', provider: event.target.value, model: '' }, reasoning: { mode: 'inherit-compatible' } }) }, h('option', { value: '' }, t('chooseProvider')), providerOptions(model.provider))),
          fixed && h(Field, { label: t('model') }, h('select', { ...field('model'), value: model.model || '', disabled: disabled || !model.provider, 'aria-busy': optionState.busy, onFocus: () => controller.loadModelOptions(model.provider), onChange: event => set({ model: { ...model, model: event.target.value }, reasoning: { mode: 'inherit-compatible' } }) }, h('option', { value: '' }, optionState.busy ? t('loading') : t('chooseModel')), selectionOptions(model.model, options, optionState.loaded).map(item => h('option', { key: item.id, value: item.id }, optionLabel(item))))),
          !auto && h(Field, { label: t('effortMode') }, h('select', { ...field('effort-mode'), value: reasoning.mode, disabled, onChange: event => set({ reasoning: event.target.value === 'fixed' ? { mode: 'fixed', effort: '' } : { mode: event.target.value } }) }, h('option', { value: 'inherit-compatible' }, t('inheritEffort')), h('option', { value: 'model-default' }, t('defaultEffort')), h('option', { value: 'fixed' }, t('fixedEffort')))),
          !auto && reasoning.mode === 'fixed' && h(Field, { label: t('effort') }, h('select', { ...field('effort'), value: reasoning.effort || '', disabled, onChange: event => set({ reasoning: { mode: 'fixed', effort: event.target.value } }) }, h('option', { value: '' }, t('chooseEffort')), reasoning.effort && !exact?.efforts?.some(item => item.id === reasoning.effort) && h('option', { value: reasoning.effort }, reasoning.effort), exact?.efforts?.map(item => h('option', { key: item.id || item, value: item.id || item, title: item.description }, optionText(item.name, item.id || item))))),
          auto && h(Field, { label: t('defaultCandidate') }, h('select', { ...field('default-candidate'), value: model.defaultCandidate, disabled, onChange: event => set({ model: { ...model, defaultCandidate: event.target.value } }) }, model.candidates.map((item, index) => h('option', { key: index, value: item.id }, item.id || t('candidate', { number: index + 1 })))))
        ),
        auto && h('div', { className: 'ad-candidates' }, h('p', { className: 'ad-help' }, t('autoHint')), h('p', { className: 'ad-help' }, t('candidateHint')),
          model.candidates.map((item, index) => {
            const prefix = 'candidate-' + index + '-';
            const candidateField = name => field(prefix + name);
            const update = patch => controller.updateCandidate(agent.id, index, patch);
            const candidateOptions = controller.modelOptionsState(item.provider);
            const candidateMetadata = controller.modelMetadataState(item.provider, item.model);
            const efforts = candidateMetadata.model?.metadataResolved ? candidateMetadata.model.efforts || [] : [];
            const metadataError = candidateMetadata.error || (candidateMetadata.model?.error ? { message: candidateMetadata.model.error } : null);
            return h('fieldset', { className: 'ad-candidate', key: index, disabled }, h('legend', null, t('candidate', { number: index + 1 })),
              h('div', { className: 'ad-fields' },
                h(Field, { label: t('candidateId') }, h('input', { ...candidateField('id'), value: item.id, maxLength: 64, autoCapitalize: 'off', spellCheck: false, onChange: event => update({ id: event.target.value }) })),
                h(Field, { label: t('candidatePurpose') }, h('input', { ...candidateField('purpose'), value: item.purpose, maxLength: 240, onChange: event => update({ purpose: event.target.value }) })),
                h(Field, { label: t('provider') }, h('select', { ...candidateField('provider'), value: item.provider, 'aria-busy': Boolean(state.busy.providers), onFocus: () => controller.loadProviders(), onChange: event => controller.setCandidateProvider(agent.id, index, event.target.value) }, h('option', { value: '' }, t('chooseProvider')), providerOptions(item.provider))),
                h(Field, { label: t('model') }, h('select', { ...candidateField('model'), value: item.model, disabled: !item.provider, 'aria-busy': candidateOptions.busy, onFocus: () => { controller.loadCandidateOptions(agent.id, index); controller.loadCandidateMetadata(agent.id, index); }, onChange: event => controller.setCandidateModel(agent.id, index, event.target.value) }, h('option', { value: '' }, candidateOptions.busy ? t('loading') : t('chooseModel')), selectionOptions(item.model, candidateOptions.items, candidateOptions.loaded).map(option => h('option', { key: option.id, value: option.id }, optionLabel(option))))),
                h(Field, { label: t('effortMode') }, h('select', { ...candidateField('effort-mode'), value: item.reasoning.mode, onFocus: () => { if (item.reasoning.mode === 'fixed') controller.loadCandidateMetadata(agent.id, index); }, onChange: event => { update({ reasoning: event.target.value === 'fixed' ? { mode: 'fixed', effort: '' } : { mode: 'model-default' } }); if (event.target.value === 'fixed') controller.loadCandidateMetadata(agent.id, index); } }, h('option', { value: 'model-default' }, t('defaultEffort')), h('option', { value: 'fixed' }, t('fixedEffort')))),
                item.reasoning.mode === 'fixed' && h(Field, { label: t('effort') }, h('select', { ...candidateField('effort'), value: item.reasoning.effort || '', disabled: !item.provider || !item.model || candidateMetadata.busy, 'aria-busy': candidateMetadata.busy, onFocus: () => controller.loadCandidateMetadata(agent.id, index), onChange: event => update({ reasoning: { mode: 'fixed', effort: event.target.value } }) }, h('option', { value: '' }, candidateMetadata.busy ? t('loading') : t('chooseEffort')), selectionOptions(item.reasoning.effort, efforts, Boolean(candidateMetadata.model?.metadataResolved)).map(effort => h('option', { key: effort.id, value: effort.id, title: effort.description }, optionLabel(effort))))),
              ),
              candidateOptions.loaded && !candidateOptions.items.length && h('p', { className: 'ad-help' }, t('noModelOptions')),
              h(ErrorNotice, { value: candidateOptions.error, t, retry: () => controller.loadCandidateOptions(agent.id, index, true) }),
              h(ErrorNotice, { value: metadataError, t, retry: () => controller.loadCandidateMetadata(agent.id, index, true) }),
              h(Button, { disabled: disabled || model.candidates.length <= 1, 'aria-label': t('removeCandidate') + ': ' + (item.id || index + 1), onClick: () => controller.removeCandidate(agent.id, index) }, t('removeCandidate')));
          }),
          h(Button, { disabled, onClick: () => controller.addCandidate(agent.id) }, t('addCandidate'))),
        (fixed || auto) && h(SuggestionPanel, { state, controller, id: agent.id, draft, disabled, t }),
        issues.length > 0 && h('ul', { className: 'ad-list ad-error', role: 'alert' }, issues.map((issue, index) => h('li', { key: index }, t(issue.key, issue)))),
        savedCandidates.length > 0 && h('div', { className: 'ad-fields' }, h(Field, { label: t('previewCandidate') }, h('select', { ...field('preview-candidate'), value: selectedCandidate, onChange: event => controller.selectPreviewCandidate(agent.id, event.target.value) }, savedCandidates.map(item => h('option', { key: item.id, value: item.id }, item.id + ' · ' + item.purpose))))),
        isDirty(draft) && h('p', { className: 'ad-help ad-warning' }, t('previewDraft')),
        h(ErrorNotice, { value: state.errors.providers, t, retry: () => controller.loadProviders(true) }),
        fixed && h(ErrorNotice, { value: metadata.error, t, retry: () => controller.loadModels(model.provider, model.model) }),
        fixed && h(ErrorNotice, { value: optionState.error, t, retry: () => controller.loadModelOptions(model.provider, true) }),
        fixed && metadata.busy && h('p', { className: 'ad-help', role: 'status' }, t('loading')),
        h(Stats, { rows: [
          [t('configuredModel'), facts.configuredSelection?.provider && facts.configuredSelection?.model ? facts.configuredSelection.provider + ' / ' + facts.configuredSelection.model : t('unknown')],
          [t('configuredEffort'), facts.configuredSelection ? facts.configuredSelection.reasoningEffort ?? t('defaultEffort') : t('unknown')],
          [t('effectiveModel'), facts.effectiveSelection?.provider && facts.effectiveSelection?.model ? facts.effectiveSelection.provider + ' / ' + facts.effectiveSelection.model : t('unknown')],
          [t('effectiveEffort'), facts.effectiveSelection?.reasoningEffort ?? t('unknown')],
          [t('authorization'), t(!state.sessionId ? 'noSession' : { authorized: 'authorized', denied: 'denied' }[authorization] || 'authorizationUnknown')],
          [t('contextWindow'), exact?.contextWindow ?? t('unknown')],
          [t('defaultEffort'), exact?.defaultEffort ?? t('unknown')],
          [t('sessionEffort'), (models?.selection || preview?.sessionSelection)?.reasoningEffort ?? t('unknown')],
          [t('modalities'), exact?.inputModalities?.map(value => dictionaries.en['modality.' + value] ? t('modality.' + value) : value).join(', ') || t('unknown')]
        ] }),
        facts.authorization.code === 'AGENTDECK_MODEL_NOT_AUTHORIZED'
          ? h('div', { className: 'ad-warning', role: 'alert' },
            h('p', null, t('modelDeniedHint', { route: facts.authorization.route.provider + ' / ' + facts.authorization.route.model })),
            h('p', null, t('allowedRoutes', { routes: facts.authorization.allowedModels.map(item => item.provider + ' / ' + item.model).join(', ') || t('none') })),
            h('p', { className: 'ad-help' }, t('authorizationRecovery')))
          : facts.authorization.message && h('p', { className: 'ad-warning', role: 'alert' }, facts.authorization.message),
        h('p', { className: 'ad-help' }, t('effectiveHint')),
        exact?.error && h('p', { className: 'ad-error' }, exact.error),
        !exact && !metadata.busy && h('p', { className: 'ad-help' }, t('metadataUnavailable')),
        fixed && h(DiagnosticList, { items: models?.diagnostics, t })
      );
    }
    function useConfirmation() {
      const [kind, setKind] = React.useState('');
      const origin = React.useRef(null);
      const cancelButton = React.useRef(null);
      React.useEffect(() => {
        if (kind) {
          cancelButton.current?.focus();
        } else if (origin.current) {
          const { trigger, fallback } = origin.current;
          origin.current = null;
          (trigger.isConnected && !trigger.disabled ? trigger : fallback)?.focus();
        }
      }, [kind]);
      return { kind, cancelButton, close: () => setKind(''), open(event, next) {
        const trigger = event.currentTarget;
        origin.current = { trigger, fallback: trigger.closest('.ad-root')?.querySelector('#agentdeck-tab-roles') };
        setKind(next);
      } };
    }
    function RoleDetail({ state, controller, t, locale, exportDraft }) {
      const { kind: confirmation, open: openConfirmation, close: closeConfirmation, cancelButton } = useConfirmation();
      React.useEffect(closeConfirmation, [state.selectedId, state.sessionId]);
      const cached = state.evidence[state.selectedId];
      const currentPreview = state.preview || (cached?.context === state.sessionId && cached.candidateId === (state.previewCandidates[state.selectedId] || state.catalog?.agents.find(item => item.id === state.selectedId)?.model.defaultCandidate) ? cached.preview : null);
      const agent = roleView(state.catalog?.agents.find(item => item.id === state.selectedId), currentPreview);
      const draft = state.drafts[state.selectedId];
      const override = state.catalog?.overrides.find(item => item.id === state.selectedId);
      if (!draft) return h('p', { className: 'ad-empty' }, t('chooseRole'));
      const dirty = isDirty(draft);
      const form = draft.form;
      const readOnly = !controller.canEdit(state.selectedId);
      const locked = readOnly || !form || (dirty && draft.kind === 'raw');
      const localized = value => locale.resolveText(value);
      const preview = currentPreview?.agent.id === agent?.id && currentPreview?.agent.revision === agent?.revision ? currentPreview : null;
      const facts = previewFacts(preview, state.sessionId);
      const previewNeedsSessionValidation = !state.sessionId && previewNeedsSession(preview?.diagnostics);
      const invalidForm = draft.kind === 'form' && formIssues(form).length > 0;
      const yamlPending = Boolean(draft.actions?.length && !draft.materialized);
      const change = state.changePreview?.draftId === state.selectedId ? state.changePreview : null;
      const resetCustom = agent && !agent.builtin;
      return h('article', { className: 'ad-detail' },
        h('div', { className: 'ad-detail-head' }, h('div', null,
          h('h3', null, agent ? localized(agent.title) : state.selectedId),
          h('div', { className: 'ad-role-meta' }, h('code', null, state.selectedId), agent && h('span', null, t(agent.builtin ? 'builtin' : 'custom')), override && h('span', null, t('override')))),
          h('div', { className: 'ad-actions' }, agent && h(Button, { disabled: readOnly, onClick: () => controller.beginCreate(agent.id) }, t('derive')), h(Button, { onClick: () => exportDraft(state.selectedId) }, t('export')))),
        agent?.extends && h('p', { className: 'ad-help' }, t('effectiveParent', { id: agent.extends, source: state.catalog?.agents.find(item => item.id === agent.id)?.parentSource || 'builtin' })),
        agent && h('p', { className: 'ad-detail-desc' }, localized(agent.description)),
        (readOnly || draft.writeSessionId) && h('div', { className: 'ad-actions' },
          h('p', { className: 'ad-help', role: 'status' }, t(readOnly ? dirty ? 'draftScopeMismatch' : 'projectReadOnly' : 'projectWriteBound', { session: draft.writeSessionId || t('noSession') })),
          readOnly && !dirty && state.sessionId && h(Button, { onClick: () => controller.useProjectEdit(state.selectedId) }, t('useProjectEdit'))),
        agent && h('div', { className: 'ad-tags' },
          h(RoleStatusBadge, { agent, selectedModel: true, sessionSelected: Boolean(state.sessionId), t }),
          h('span', { className: 'ad-tag' }, t('revision') + ' ' + agent.revision.slice(0, 12)),
          agent.id === 'general' && h('span', { className: 'ad-tag' }, t('generalFallback'))),
        agent?.missingCapabilities.length > 0 && h('p', { className: 'ad-warning' }, t('missing', { items: agent.missingCapabilities.map(id => t('cap.' + id)).join(', ') })),
        agent?.unverifiedCapabilities?.length > 0 && h('p', { className: 'ad-help' }, t('capabilityPending', { items: agent.unverifiedCapabilities.map(id => t('cap.' + id)).join(', ') })),
        agent?.browserSupport && h('p', { className: 'ad-help' }, t('browserSupport') + ': ' + t({ ready: 'browserReady', unverified: 'browserUnverified', unsupported: 'browserUnsupported' }[agent.browserSupport.state] || 'unknown') + ' · ' + t({ ready: 'browserReadyHint', unverified: 'browserUnverifiedHint', unsupported: 'browserUnsupportedHint' }[agent.browserSupport.state] || 'browserUnverifiedHint')),
        agent?.browserSupport?.reason && h(CodeDetail, { title: t('originalDiagnostic'), value: agent.browserSupport.reason }),
        agent && h('div', { className: 'ad-section' },
          h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', role: 'switch', 'aria-checked': form?.enabled ?? agent.enabled, checked: form?.enabled ?? agent.enabled, disabled: locked || state.busy.save, onChange: event => controller.updateForm(agent.id, { enabled: event.target.checked }) }), h('span', null, t((form?.enabled ?? agent.enabled) ? 'enabled' : 'disabled'))),
          h('p', { className: 'ad-help' }, t('newStarts'))),
        agent && h(ModelControls, { state, controller, agent, draft, t }),
        agent && h('section', { className: 'ad-section' }, h('p', { className: 'ad-help' }, t('nativeRecoveryHint')),
          previewNeedsSessionValidation && h('p', { className: 'ad-help', role: 'status' }, t('previewSessionHint')),
          h(ErrorNotice, { value: state.errors.preview, t, retry: () => controller.loadPreview(agent.id) }),
          h(DiagnosticList, { items: previewDiagnostics(preview?.diagnostics, state.sessionId), t })),
        h('section', { className: 'ad-section', 'aria-label': t('yaml') },
          h(ChangeReview, { change, state, controller, t, locale }),
          h(ErrorNotice, { value: state.errors.changePreview, t }),
          !readOnly && dirty && draft.kind === 'raw' && agent && h(Button, { disabled: state.busy.changePreview || state.busy.save, onClick: () => controller.openForm(agent.id) }, t('openValidatedForm')),
          agent && !locked && override && h('details', { className: 'ad-details' }, h('summary', null, t('restoreFields')), h('div', { className: 'ad-actions' },
            [['model', 'clearLocalModel'], ['reasoning', 'reasoning'], ['enabled', 'enabled']].map(([field, label]) => h(Button, { key: field, disabled: state.busy.changePreview || state.busy.save, onClick: () => controller.restoreField(agent.id, field) }, t(label))))),
          yamlPending && h(Button, { disabled: invalidForm || state.busy.changePreview, onClick: () => controller.materializeDraft(state.selectedId) }, t(state.busy.changePreview ? 'loading' : 'previewChange')),
          h('label', { className: 'ad-field' }, h('span', null, t('yaml')), h('span', { className: 'ad-help' }, t('yamlHint')),
            h('textarea', { className: 'ad-yaml', value: draft.text, spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off', readOnly, disabled: yamlPending, onChange: event => controller.edit(state.selectedId, event.target.value) })),
          h(ErrorNotice, { value: state.errors.save, t, save: true }), h(ErrorNotice, { value: state.errors.reset, t }),
          h('div', { className: 'ad-savebar' }, h('span', { className: 'ad-help', role: 'status' }, dirty ? t('dirty') : ''), h('div', { className: 'ad-actions' },
            dirty && h(Button, { disabled: state.busy.save || state.busy.reset, onClick: event => openConfirmation(event, 'discard') }, t('discard')),
            h(Button, { primary: true, disabled: readOnly || !dirty || invalidForm || state.busy.save || state.busy.reset, onClick: () => controller.save(state.selectedId) }, t(state.busy.save ? 'saving' : 'save')))),
          override && !readOnly && h('div', { className: 'ad-actions', style: { marginTop: 12 } }, h(Button, { danger: true, disabled: state.busy.save || state.busy.reset, onClick: event => { openConfirmation(event, 'reset'); void controller.previewChange(state.selectedId, true); } }, t(resetCustom ? 'deleteCustom' : 'reset'))),
          confirmation && h('div', { className: 'ad-inline-confirm' }, h('p', null, t(confirmation === 'discard' ? 'discardConfirm' : resetCustom ? 'deleteConfirm' : 'resetConfirm')), h('div', { className: 'ad-actions' }, h(Button, { danger: true, disabled: (confirmation === 'reset' && readOnly) || state.busy.save || state.busy.reset, onClick: () => { if (confirmation === 'discard') { controller.discard(state.selectedId); closeConfirmation(); } else controller.reset(state.selectedId).then(answer => { if (answer.ok && !controller.isDisposed()) closeConfirmation(); }); } }, t(confirmation === 'discard' ? 'discard' : resetCustom ? 'confirmDelete' : 'confirmReset')), h(Button, { buttonRef: cancelButton, onClick: closeConfirmation }, t('cancel'))))),
        agent && h('section', { className: 'ad-section', 'aria-label': t('scope') }, h('h4', null, t('scope')),
          h(Stats, { rows: [[t('capabilities'), agent.capabilities.map(id => t('cap.' + id)).join(', ') || t('none')], [t('skills'), agent.presentation?.skills.map(skill => localized(skill.title)).join(', ') || agent.skills.join(', ') || t('none')], [t('scripts'), agent.scripts.join(', ') || t('none')]] }),
          agent.presentation?.skills.map(skill => h('p', { key: skill.id, className: 'ad-help' }, localized(skill.title) + ' · ' + localized(skill.description))),
          h(CodeDetail, { title: t('inputs'), value: agent.presentation?.inputs.map(localized) || agent.inputs }), h(CodeDetail, { title: t('deliverables'), value: agent.presentation?.deliverables.map(localized) || agent.deliverables }), h(CodeDetail, { title: t('instructions'), value: agent.instructions }))
      );
    }
    function SuggestionSettings({ model, reasoning, t }) {
      const effort = value => value?.mode === 'fixed' ? value.effort : t('defaultEffort');
      return model.mode === 'fixed'
        ? h('p', null, model.provider + ' / ' + model.model + ' · ' + effort(reasoning))
        : h(React.Fragment, null,
          h('p', { className: 'ad-help' }, t('suggestCandidateCount', { count: model.candidates.length })),
          h('ul', { className: 'ad-list' }, model.candidates.map(item => h('li', { key: item.id }, h('strong', null, item.id + (item.id === model.defaultCandidate ? ' · ' + t('defaultCandidate') : '')), h('p', null, item.provider + ' / ' + item.model + ' · ' + effort(item.reasoning)), h('p', null, item.purpose)))));
    }
    function SuggestionPanel({ state, controller, id, draft, disabled, t }) {
      const options = state.suggestions[id];
      const busy = Boolean(state.busy['suggest:' + id]);
      const mode = draft.form.model.mode;
      if (!options?.open) return h('section', { className: 'ad-suggestion-launch', 'aria-label': t('suggestTitle') },
        h('div', { className: 'ad-suggestion-launch-copy' }, h('h4', null, t('suggestOpenTitle')), h('p', { className: 'ad-help' }, t(mode === 'auto' ? 'suggestOpenAutoHint' : 'suggestOpenFixedHint'))),
        h(Button, { primary: true, disabled, onClick: () => controller.openSuggestion(id) }, t('suggestOpen')));
      const generator = options.generator;
      const candidatePlan = options.candidatePlan || 'auto';
      const providers = controller.suggestionModelOptionsState();
      const models = controller.suggestionModelOptionsState(generator.provider);
      const current = controller.suggestionCurrent(id);
      const field = name => ({ id: 'agentdeck-' + id + '-suggest-' + name, name: 'suggest-' + name });
      const update = patch => controller.updateSuggestion(id, patch);
      const label = item => item.name || item.id;
      return h('section', { className: 'ad-suggestion-panel', 'aria-label': t('suggestTitle') },
        h('div', { className: 'ad-suggestion-head' }, h('div', null, h('h4', null, t('suggestTitle')), h('p', { className: 'ad-help' }, t(mode === 'auto' ? 'suggestAutoHint' : 'suggestFixedHint'))), h(Button, { onClick: () => update({ open: false }) }, t(busy ? 'cancel' : 'close'))),
        h('p', { className: 'ad-help' }, t('suggestGeneratorHint')),
        h('div', { className: 'ad-fields' },
          h(Field, { label: t('suggestProvider') }, h('select', { ...field('provider'), value: generator.provider, disabled: busy, 'aria-busy': providers.busy, onFocus: () => controller.loadSuggestionModelOptions(), onChange: event => { update({ generator: { provider: event.target.value, model: '' } }); if (event.target.value) void controller.loadSuggestionModelOptions(event.target.value); } }, h('option', { value: '' }, t('chooseProvider')), selectionOptions(generator.provider, providers.items, providers.loaded).map(item => h('option', { key: item.id, value: item.id }, label(item))))),
          h(Field, { label: t('suggestModel') }, h('select', { ...field('model'), value: generator.model, disabled: busy || !generator.provider, 'aria-busy': models.busy, onFocus: () => generator.provider && controller.loadSuggestionModelOptions(generator.provider), onChange: event => update({ generator: { ...generator, model: event.target.value } }) }, h('option', { value: '' }, models.busy ? t('loading') : t('chooseModel')), selectionOptions(generator.model, models.items, models.loaded).map(item => h('option', { key: item.id, value: item.id }, label(item)))))),
        mode === 'auto' && h(Field, { label: t('suggestCandidatePlan'), help: t(candidatePlan === 'multiple' ? 'suggestMultipleHint' : 'suggestPlanHint') }, h('select', { ...field('candidate-plan'), value: candidatePlan, disabled: busy, onChange: event => update({ candidatePlan: event.target.value }) }, h('option', { value: 'auto' }, t('suggestPlanAuto')), h('option', { value: 'multiple' }, t('suggestPlanMultiple')))),
        h(ErrorNotice, { value: providers.error, t, retry: () => controller.loadSuggestionModelOptions('', true) }),
        generator.provider && h(ErrorNotice, { value: models.error, t, retry: () => controller.loadSuggestionModelOptions(generator.provider, true) }),
        providers.loaded && !providers.items.length && h('p', { className: 'ad-help' }, t('noProviders')),
        generator.provider && models.loaded && !models.items.length && h('p', { className: 'ad-help' }, t('noModelOptions')),
        h(Field, { label: t('suggestRequirements') }, h('textarea', { ...field('requirements'), rows: 3, value: options.requirements, disabled: busy, onChange: event => update({ requirements: event.target.value }) })),
        h('p', { className: 'ad-help', role: 'status' }, t('suggestGenerateHint')),
        h('div', { className: 'ad-actions' },
          h(Button, { primary: true, disabled: disabled || busy || !generator.provider || !generator.model, onClick: () => controller.generateSuggestion(id) }, t(busy ? 'suggestGenerating' : 'suggestGenerate'))),
        h(ErrorNotice, { value: state.errors['suggest:' + id], t }),
        options.result && h('div', { className: 'ad-section' },
          h('p', null, options.result.reason), !current && !options.adopted && h('p', { className: 'ad-warning' }, t('suggestStale')),
          options.adopted && h('p', { className: 'ad-help', role: 'status' }, t('suggestAdopted')),
          h('div', { className: 'ad-fields' }, h('div', null, h('h5', null, t('suggestBefore')), h(SuggestionSettings, { model: options.before.model, reasoning: options.before.reasoning, t })), h('div', null, h('h5', null, t('suggestAfter')), h(SuggestionSettings, { model: options.result.model, reasoning: options.result.reasoning, t }))),
          h(DiagnosticList, { items: options.result.diagnostics, t }),
          h(Button, { disabled: disabled || busy || !current, onClick: () => controller.adoptSuggestion(id) }, t('suggestAdopt')),
          h('p', { className: 'ad-help' }, t('suggestAdoptHint'))));
    }
    const roleReview = role => role && Object.fromEntries(['source', 'extends', 'schemaVersion', 'enabled', 'model', 'reasoning'].filter(key => role[key] !== undefined).map(key => [key, role[key]]));
    function ChangeReview({ change, state, controller, t, locale }) {
      if (!change) return null;
      return h('section', { className: 'ad-section', 'aria-label': t('changeReview') },
        h('h4', null, t('changeReview') + ' · ' + change.id), h('p', { className: 'ad-help' }, t(change.reset ? 'changeDelete' : 'changeWrite')),
        change.parent && h('p', { className: 'ad-help' }, t('effectiveParent', change.parent)),
        change.project && h('p', { className: 'ad-help' }, t('setupImpactOtherProject', { cwd: change.project })),
        change.direct && h('div', { className: 'ad-fields' }, h(CodeDetail, { title: t('setupBefore'), value: roleReview(change.direct.before) }), h(CodeDetail, { title: t('setupAfter'), value: roleReview(change.direct.after) })),
        h(CodeDetail, { title: t('setupBefore'), value: change.currentText }), h(CodeDetail, { title: t('setupYaml'), value: change.text }),
        change.impacts.map(impact => h('article', { className: 'ad-candidate', key: impact.id },
          h('strong', null, (impact.title ? locale.resolveText(impact.title) + ' · ' : '') + impact.id),
          [['setupImpactProject', impact.scope !== 'projects' && impact.scope !== 'global' && impact], ['setupImpactGlobal', impact.global || (impact.scope === 'global' && impact)], ...(impact.projects || []).map(project => ['setupImpactOtherProject', project])].filter(([, entry]) => entry).map(([label, entry]) => h('div', { key: entry.cwd || label },
            h('p', null, t(label, { cwd: entry.cwd })), h(CodeDetail, { title: t('setupBefore'), value: entry.before }), h(CodeDetail, { title: t('setupAfter'), value: entry.after }))),
          impact.requiresAcceptance !== false && h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: state.changeAccepted[impact.id] === true, disabled: state.busy.save || state.busy.reset, onChange: event => controller.acceptChangeImpact(impact.id, event.target.checked) }), t('setupAcceptImpact')))));
    }
    function NewRole({ state, controller, t, locale, exportDraft }) {
      const { kind: discarding, open: openConfirmation, close: closeConfirmation, cancelButton } = useConfirmation();
      const draft = state.drafts['@new'];
      if (!state.creating || !draft) return null;
      if (!controller.canEdit('@new')) return h('p', { className: 'ad-warning', role: 'status' }, t('draftScopeMismatch', { session: draft.writeSessionId || t('noSession') }));
      const id = state.identity?.text === draft.text ? state.identity.id : '';
      const existing = state.catalog?.agents.find(agent => agent.id === id);
      const override = state.catalog?.overrides.find(item => item.id === id);
      const duplicate = existing || override;
      const conflict = isDirty(state.drafts[id]);
      const source = existing?.source && !existing.source.startsWith('user:') ? existing.source : '';
      const change = state.changePreview?.draftId === '@new' ? state.changePreview : null;
      return h('section', { className: 'ad-new', 'aria-label': t('newTitle') },
        h('h3', null, t('newTitle')), h('p', { className: 'ad-help' }, t(state.imported ? 'importHint' : 'newHint')),
        h('div', { className: 'ad-fields' },
          h(Field, { label: t('id'), help: t('idHint') }, h('input', { value: state.imported ? id : state.newId, readOnly: state.imported, autoCapitalize: 'off', spellCheck: false, onChange: event => controller.setNewId(event.target.value) })),
          !state.imported && h(Field, { label: t('base') }, h('select', { value: state.newBase, onChange: event => controller.setNewBase(event.target.value) }, state.catalog?.agents.map(agent => h('option', { key: agent.id, value: agent.id }, locale.resolveText(agent.title) + ' · ' + agent.id))))),
        h('label', { className: 'ad-field', style: { marginTop: 12 } }, h('span', null, t('yaml')), h('textarea', { className: 'ad-yaml', value: draft.text, spellCheck: false, onChange: event => controller.edit('@new', event.target.value) })),
        h(ErrorNotice, { value: state.errors.identity || state.errors.changePreview || state.errors.save, t, save: true }),
        h(ChangeReview, { change, state, controller, t, locale }),
        duplicate && h('p', { role: 'status' }, t('existingTarget', { id, revision: (override?.revision || existing?.revision || '').slice(0, 12) })),
        conflict && h('p', { className: 'ad-warning' }, t('draftConflict')),
        source && h('p', { className: 'ad-warning' }, t('setupSourceProtected') + ' · ' + source),
        h('div', { className: 'ad-actions', style: { marginTop: 12 } }, duplicate ? h(Button, { primary: true, disabled: conflict || Boolean(source), onClick: () => controller.useExistingDocument() }, t('useExistingTarget')) : h(Button, { primary: true, disabled: !id || state.busy.identity || state.busy.changePreview || state.busy.save || change?.impacts.some(item => item.requiresAcceptance !== false && !state.changeAccepted[item.id]), onClick: () => controller.save('@new') }, t(state.busy.save ? 'saving' : 'create')), h(Button, { onClick: () => exportDraft('@new') }, t('export')), h(Button, { disabled: state.busy.save, onClick: () => controller.set({ creating: false }) }, t('cancel')), h(Button, { danger: true, disabled: state.busy.save, onClick: event => openConfirmation(event, 'discard') }, t('discard'))),
        discarding && h('div', { className: 'ad-inline-confirm' }, h('p', null, t('discardConfirm')), h('div', { className: 'ad-actions' }, h(Button, { danger: true, onClick: () => { const drafts = { ...state.drafts }; delete drafts['@new']; controller.set({ drafts, creating: false }); closeConfirmation(); } }, t('discard')), h(Button, { buttonRef: cancelButton, onClick: closeConfirmation }, t('cancel'))))
      );
    }
    function SessionField({ id, label, help, value, sessions, empty, disabled, onChange }) {
      return h('div', { className: 'ad-session' }, h('label', { htmlFor: id }, label),
        h('div', { className: 'ad-stack' }, h('select', { id, value, disabled, onChange: event => onChange(event.target.value) },
          h('option', { value: '' }, empty), value && !sessions.some(item => item.id === value) && h('option', { value }, value),
          sessions.map(item => h('option', { key: item.id, value: item.id }, item.title || item.id))), h('p', { className: 'ad-help' }, help)));
    }
    function Runs({ state, controller, t, locale }) {
      const sessions = new Map((state.catalog?.sessions || []).map(item => [item.id, item]));
      for (const id of state.runParents) if (!sessions.has(id)) sessions.set(id, { id });
      return h('section', { 'aria-label': t('runs') }, h('p', { className: 'ad-help' }, t('runsHint')),
        h(SessionField, { id: 'agentdeck-run-parent', label: t('runParent'), help: t('runParentHint'), value: state.runParentId, sessions: [...sessions.values()], empty: t('allSessions'), onChange: value => { controller.setRunParent(value); void controller.loadRuns(); } }),
        h(ErrorNotice, { value: state.errors.runs, t }),
        state.busy.runs && h('p', { className: 'ad-empty', role: 'status' }, t('loading')),
        state.runs?.length === 0 && h('p', { className: 'ad-empty' }, t('noRuns')),
        state.runCursor && h(Button, { disabled: state.busy.runs, onClick: () => controller.loadRuns(true) }, t('loadMore')),
        state.runs?.map(run => h('article', { className: 'ad-run', key: run.id },
          h('p', { className: 'ad-run-title' }, run.description),
          h('div', { className: 'ad-run-meta' }, h('code', null, run.roleId), h('span', null, t('phase') + ': ' + t(run.phase)), h('span', null, t('nativeStatus') + ': ' + enumText(run.nativeStatus, t)), h('span', null, t('businessStatus') + ': ' + enumText(businessStatus(run), t))),
          h('div', { className: 'ad-run-meta' }, h('span', null, t('revision') + ': ' + run.revision.slice(0, 12)), h('time', { dateTime: run.createdAt }, t('created') + ': ' + formatDate(run.createdAt, locale.getSnapshot().active))),
          run.businessStatusCheckedAt && h('p', { className: 'ad-help' }, t('checkedAt', { time: formatDate(run.businessStatusCheckedAt, locale.getSnapshot().active) })),
          run.model && h('p', { className: 'ad-help' }, run.model.provider + ' / ' + run.model.model + (run.model.reasoningEffort ? ' · ' + run.model.reasoningEffort : '')),
          run.error && h('p', { className: 'ad-error' }, run.error),
          h('div', { className: 'ad-run-actions' }, run.childId ? h(Button, { onClick: () => controller.loadResult(run.childId), disabled: state.busy.result && state.resultChild === run.childId }, t('results')) : h('span', { className: 'ad-help' }, t('noChild'))),
          Boolean(run.childId) && state.resultChild === run.childId && h('section', { className: 'ad-result', 'aria-label': t('result'), 'aria-busy': Boolean(state.busy.result) },
            h('div', { className: 'ad-detail-head' }, h('h3', null, t('result')), h(Button, { onClick: () => controller.closeResult() }, t('closeResult'))),
            h(ErrorNotice, { value: state.errors.result, t, retry: () => controller.loadResult(run.childId) }),
            state.busy.result && h('p', { role: 'status' }, t('loading')),
            state.result && h(React.Fragment, null,
              h(Stats, { rows: [[t('businessStatus'), enumText(state.resultStale ? 'unverified' : state.result.status, t)], [t('nativeStatus'), enumText(run.nativeStatus, t)], [t('child'), state.result.childId], [t('parent'), run.parentId]] }),
              h('section', { className: 'ad-section' }, h('h4', null, t('summary')), h('pre', null, typeof state.result.summary === 'string' ? state.result.summary : JSON.stringify(state.result.summary, null, 2))),
              h(CodeDetail, { title: t('evidence'), value: state.result.evidence }), h(CodeDetail, { title: t('coverage'), value: state.result.coverage }), h(CodeDetail, { title: t('artifacts'), value: state.result.artifacts }), h(CodeDetail, { title: t('limitations'), value: state.result.limitations }), h(CodeDetail, { title: t('usage'), value: state.result.usage }),
              h(CodeDetail, { title: t('nativeStop'), value: state.result.nativeStopPage?.rawText ?? state.result.nativeStop }),
              state.result.nativeStopPage && h('p', { className: 'ad-help' }, t('resultCharacters', { loaded: state.result.nativeStopPage.rawText.length, total: state.result.nativeStopPage.totalCharacters })),
              state.result.nativeStopTruncated && !state.resultStale && (!state.result.nativeStopPage || state.result.nativeStopPage.nextOffset !== undefined)
                && h(Button, { disabled: state.busy.result, onClick: () => controller.loadNativeStop(run.childId) }, t(state.result.nativeStopPage ? 'loadMore' : 'loadNativeStop')),
              h('section', { className: 'ad-section' }, h('h4', null, t('rawText')),
                state.result.provisionalText && h('p', { className: 'ad-help' }, t('provisionalText')),
                h('pre', null, state.result.rawText || t('resultEmpty')), h('p', { className: 'ad-help' }, t('resultCharacters', { loaded: (state.result.rawText || '').length, total: state.result.totalCharacters })), !state.resultStale && state.result.nextOffset !== undefined && h(Button, { disabled: state.busy.result, onClick: () => controller.loadResult(run.childId, true) }, t('loadMore'))))
          )))
      );
    }
    function formatDate(value, language) {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(language);
    }
    function ModelTransfer({ state, controller, t, locale, download }) {
      const transfer = state.transfer;
      if (!transfer) return null;
      const exporting = transfer.mode === 'export';
      const rows = transfer.rows;
      const selected = rows.filter(row => row.selected);
      const locked = transfer.checking || state.busy.save || state.busy.reset || state.busy.changeReceipt;
      const blocked = !exporting && (Boolean(state.sessionId) || selected.some(row => controller.transferIssue(row)));
      const ready = !exporting && selected.length > 0 && selected.every(row => row.preview);
      const optionLabel = item => { const value = optionText(item.name, item.id); return item.availability ? t('unavailableOption', { value }) : value; };
      const renderRoute = (row, index, route) => {
        const metadata = controller.modelMetadataState(route.provider, route.model);
        const options = controller.modelOptionsState(route.provider);
        const issue = modelTransfer.routeIssue(route, metadata.model);
        const efforts = metadata.model?.efforts || [];
        const choices = [{ mode: 'model-default' }, ...(route.key === '@fixed' ? [{ mode: 'inherit-compatible' }] : []), ...efforts.map(effort => ({ mode: 'fixed', effort: effort?.id || effort }))];
        if (!choices.some(choice => JSON.stringify(choice) === JSON.stringify(route.reasoning))) choices.unshift(route.reasoning);
        const disabled = locked || !row.selected;
        return h('div', { key: route.key, className: 'ad-section' },
          h('h5', null, route.key === '@fixed' ? t('fixed') : route.id + (row.config.model.defaultCandidate === route.id ? ' · ' + t('defaultCandidate') : '')),
          route.purpose && h('p', { className: 'ad-help' }, route.purpose),
          h('div', { className: 'ad-fields' },
            h(Field, { label: t('provider') }, h('select', { value: route.provider, disabled, onFocus: () => controller.loadProviders(), onChange: event => controller.mapTransferRoute(index, route.key, { provider: event.target.value }) }, selectionOptions(route.provider, state.providers, state.providersLoaded).map(item => h('option', { key: item.id, value: item.id }, optionLabel(item))))),
            h(Field, { label: t('model') }, h('select', { value: route.model, disabled, onFocus: () => controller.loadModelOptions(route.provider), onChange: event => controller.mapTransferRoute(index, route.key, { model: event.target.value }) }, selectionOptions(route.model, options.items, options.loaded).map(item => h('option', { key: item.id, value: item.id }, optionLabel(item))))),
            h(Field, { label: t('effort') }, h('select', { value: JSON.stringify(route.reasoning), disabled, onChange: event => controller.mapTransferRoute(index, route.key, { reasoning: JSON.parse(event.target.value) }) }, choices.map(choice => h('option', { key: JSON.stringify(choice), value: JSON.stringify(choice) }, choice.mode === 'fixed' ? choice.effort : t(choice.mode === 'model-default' ? 'defaultEffort' : 'inheritEffort')))))),
          issue && h('p', { className: 'ad-warning', role: 'status' }, t(issue)),
          metadata.model?.error && h('p', { className: 'ad-help' }, metadata.model.error),
          h(ErrorNotice, { value: metadata.error || options.error, t }),
          route.key !== '@fixed' && h('div', null, h(Button, { disabled: disabled || row.config.model.candidates.length <= 1 || row.config.model.defaultCandidate === route.key, onClick: () => controller.removeTransferRoute(index, route.key) }, t('transferRemoveCandidate')), row.config.model.candidates.length > 1 && row.config.model.defaultCandidate === route.key && h('p', { className: 'ad-help' }, t('transferRemoveDefaultHint'))));
      };
      return h('section', { className: 'ad-section', 'aria-label': t(exporting ? 'exportModels' : 'importModels') },
        h('h3', null, t(exporting ? 'exportModels' : 'importModels')),
        h('p', { className: 'ad-help' }, t(exporting ? 'transferExportHint' : 'transferImportHint')),
        !exporting && h('p', { className: 'ad-help' }, t('transferInheritedHint')),
        h(ErrorNotice, { value: state.errors.transfer, t }),
        transfer.checking && h('p', { role: 'status' }, t('transferChecking')),
        exporting && h('div', { className: 'ad-actions' }, h(Button, { onClick: () => rows.forEach((_, index) => controller.updateModelTransfer(index, { selected: true })) }, t('transferSelectAll')), h(Button, { onClick: () => rows.forEach((_, index) => controller.updateModelTransfer(index, { selected: false })) }, t('transferSelectNone'))),
        rows.map((row, index) => {
          const target = state.catalog.agents.find(item => item.id === (exporting ? row.id : row.targetId));
          const issue = !exporting && row.selected ? controller.transferIssue(row) : '';
          return h('div', { key: row.id, className: 'ad-section' },
            h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: row.selected, disabled: locked, onChange: event => controller.updateModelTransfer(index, { selected: event.target.checked }) }), row.id + (exporting && target ? ' · ' + locale.resolveText(target.title) : '')),
            !exporting && h(React.Fragment, null,
              h(Field, { label: t('transferTarget') }, h('select', { value: row.targetId, disabled: locked, onChange: event => controller.updateModelTransfer(index, { targetId: event.target.value, selected: Boolean(event.target.value) }) }, h('option', { value: '' }, t('transferSkip')), state.catalog.agents.map(agent => h('option', { key: agent.id, value: agent.id }, agent.id + ' · ' + locale.resolveText(agent.title))))),
              issue && h('p', { className: 'ad-warning', role: 'status' }, t(issue)),
              h('details', { className: 'ad-details' }, h('summary', null, t('transferMapping') + ' · ' + t(row.config.model.mode)),
                row.config.model.mode === 'auto' && h(Field, { label: t('defaultCandidate') }, h('select', { value: row.config.model.defaultCandidate, disabled: locked || !row.selected, onChange: event => controller.setTransferDefault(index, event.target.value) }, row.config.model.candidates.map(item => h('option', { key: item.id, value: item.id }, item.id + ' · ' + item.purpose)))),
                modelTransfer.routes(row.config).map(route => renderRoute(row, index, route)),
                !modelTransfer.routes(row.config).length && h('p', { className: 'ad-help' }, t('transferInheritedHint'))),
              row.preview && h('div', { className: 'ad-stats' },
                h(CodeDetail, { title: t('transferBefore'), value: target && modelTransfer.settings(target) }),
                h(CodeDetail, { title: t('transferAfter'), value: row.config }))),
            exporting && target && h('span', { className: 'ad-muted' }, ' · ' + t(target.model.mode)));
        }),
        h('p', { className: 'ad-help', role: 'status' }, t('transferSelected', { count: selected.length })),
        !exporting && ready && h('p', { className: 'ad-help' }, t('transferSaveHint')),
        h('div', { className: 'ad-actions' },
          exporting ? h(Button, { primary: true, disabled: !selected.length, onClick: () => { try { download(controller.exportModels(), 'agentdeck-models.json', 'application/json;charset=utf-8'); } catch (cause) { controller.error('transfer', cause); } } }, t('transferDownload'))
            : h(React.Fragment, null,
              h(Button, { disabled: locked, onClick: () => controller.checkModelTransfer(true) }, t('transferRecheck')),
              h(Button, { disabled: locked || blocked || !selected.length, onClick: () => controller.previewModelTransfer() }, t('transferPreview')),
              h(Button, { primary: true, disabled: locked || blocked || !ready, onClick: () => controller.adoptModelTransfer() }, t('transferAdopt'))),
          h(Button, { onClick: () => controller.set({ transfer: null }) }, t('close'))));
    }
    function Page({ ctx }) {
      const locale = ctx.get('locale');
      const t = locale.bind(NS);
      React.useSyncExternalStore(callback => locale.subscribe(callback), () => locale.getSnapshot(), () => locale.getSnapshot());
      const controller = React.useMemo(() => createController(ctx.get('connection')), [ctx]);
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
      const [search, setSearch] = React.useState('');
      const [filter, setFilter] = React.useState('all');
      const [reading, setReading] = React.useState(false);
      const fileInput = React.useRef(null);
      const transferInput = React.useRef(null);
      const fileReader = React.useRef(null);
      const [exportUrl, setExportUrl] = React.useState(null);
      React.useEffect(() => {
        controller.activate();
        controller.loadCatalog();
        return () => { controller.dispose(); fileReader.current?.abort(); };
      }, [controller]);
      React.useEffect(() => () => { if (exportUrl) URL.revokeObjectURL(exportUrl); }, [exportUrl]);
      const agent = state.catalog?.agents.find(item => item.id === state.selectedId);
      const draft = state.drafts[state.selectedId];
      const mode = draft?.form?.model || agent?.model;
      React.useEffect(() => {
        controller.syncReads();
      }, [controller, state.tab, state.sessionId, agent?.id, agent?.revision, mode?.mode, mode?.provider, mode?.model, state.previewCandidates[agent?.id], Boolean(state.catalog)]);
      const dirtyCount = Object.values(state.drafts).filter(isDirty).length;
      React.useEffect(() => {
        if (!dirtyCount) return;
        const warn = event => { event.preventDefault(); event.returnValue = ''; };
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
      }, [dirtyCount]);
      const download = (text, filename, type) => {
        const url = URL.createObjectURL(new Blob([text], { type }));
        setExportUrl(url);
        const link = document.createElement('a');
        link.href = url; link.download = filename; link.click();
      };
      const exportDraft = async id => {
        try {
          const text = await controller.materializeDraft(id);
          if (text === undefined || controller.isDisposed()) return;
          const url = URL.createObjectURL(new Blob([text], { type: 'application/yaml;charset=utf-8' }));
          setExportUrl(url);
          const link = document.createElement('a');
          link.href = url;
          link.download = (id === '@new' ? (state.identity?.text === text && state.identity.id) || 'agentdeck' : id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.yaml';
          link.click();
        } catch (cause) { controller.error('export', { code: 'exportFailed', message: 'exportFailed', details: { message: String(cause) } }); }
      };
      const onImport = (event, portable = false) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 1024 * 1024) { controller.error('import', { code: 'importTooLarge', message: 'importTooLarge' }); return; }
        fileReader.current?.abort();
        const reader = new FileReader();
        fileReader.current = reader;
        setReading(true);
        reader.onload = () => { if (!controller.isDisposed()) { if (portable) controller.importModels(String(reader.result)); else controller.importText(String(reader.result)); setReading(false); } };
        reader.onerror = () => { if (!controller.isDisposed()) { controller.error('import', { code: 'importReadError', message: 'importReadError' }); setReading(false); } };
        reader.onabort = () => { if (!controller.isDisposed()) setReading(false); };
        reader.readAsText(file);
      };
      const refresh = () => controller.refresh();
      const roles = (state.catalog?.agents || []).map(item => roleView(item, state.evidence[item.id]?.preview, true));
      const lowerSearch = search.toLocaleLowerCase();
      const filtered = roles.filter(item => (filter === 'all' || filter === 'enabled' && item.enabled || filter === 'unavailable' && ['disabled', 'unavailable', 'modelDenied'].includes(roleStatus(item))) && [item.id, locale.resolveText(item.title), locale.resolveText(item.description), ...item.capabilities, ...item.capabilities.map(id => t('cap.' + id))].join(' ').toLocaleLowerCase().includes(lowerSearch));
      const broken = state.catalog?.overrides.filter(item => !roles.some(agent => agent.id === item.id) && item.id.toLocaleLowerCase().includes(lowerSearch)) || [];
      const sessions = state.catalog?.sessions || [];
      return h('div', { className: 'ad-root' }, h('style', null, css),
        h('header', { className: 'ad-head' }, h('div', null, h('h2', null, t('title')), h('p', { className: 'ad-muted ad-intro' }, t('intro'))), h(Button, { disabled: state.busy.catalog, onClick: refresh }, t('refresh'))),
        h('div', { className: 'ad-tabs', role: 'tablist', 'aria-label': t('title') }, ['roles', 'runs', 'diagnostics'].map((tab, index) => h('button', { key: tab, className: 'ad-tab', type: 'button', role: 'tab', id: 'agentdeck-tab-' + tab, 'aria-selected': state.tab === tab, 'aria-controls': 'agentdeck-panel-' + tab, tabIndex: state.tab === tab ? 0 : -1, onClick: () => controller.set({ tab }), onKeyDown: event => { const tabs = ['roles', 'runs', 'diagnostics']; const next = event.key === 'ArrowRight' ? tabs[(index + 1) % 3] : event.key === 'ArrowLeft' ? tabs[(index + 2) % 3] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : null; if (next) { event.preventDefault(); controller.set({ tab: next }); event.currentTarget.parentElement.querySelector('#agentdeck-tab-' + next)?.focus(); } } }, t(tab)))),
        state.tab === 'roles' && h(SessionField, { id: 'agentdeck-session', label: t('session'), help: t('sessionHint'), value: state.sessionId, sessions, empty: t('noSession'), disabled: state.busy.save || state.busy.reset, onChange: value => { controller.setSession(value); void controller.loadCatalog(); } }),
        h(ErrorNotice, { value: state.errors.catalog, t }), h(ErrorNotice, { value: state.errors.import, t }), h(ErrorNotice, { value: state.errors.export, t }), !state.transfer && h(ErrorNotice, { value: state.errors.transfer, t }),
        state.notice && h('p', { className: 'ad-notice', role: 'status' }, t(state.notice)),
        dirtyCount > 0 && h('p', { className: 'ad-help', role: 'status' }, t('drafts', { count: dirtyCount })),
        state.busy.catalog && !state.catalog && h('p', { className: 'ad-empty', role: 'status' }, t('loading')),
        state.errors.catalog && !state.catalog && h(Button, { onClick: () => controller.loadCatalog() }, t('retry')),
        h('div', { role: 'tabpanel', id: 'agentdeck-panel-' + state.tab, 'aria-labelledby': 'agentdeck-tab-' + state.tab },
          state.tab === 'roles' && state.catalog && h(React.Fragment, null,
            h('div', { className: 'ad-actions', style: { marginBottom: 16 } }, h(Button, { onClick: () => { if (state.drafts['@new']) controller.set({ creating: true }); else controller.beginCreate(); }, disabled: Boolean(state.sessionId) || state.busy.save }, t('newRole')), h(Button, { onClick: () => fileInput.current?.click(), disabled: Boolean(state.sessionId) || reading || state.busy.save }, t(reading ? 'fileRead' : 'import')), h('input', { ref: fileInput, type: 'file', accept: '.yaml,.yml,.json,application/yaml,text/yaml,application/json', hidden: true, 'aria-label': t('import'), onChange: onImport })),
            h('div', { className: 'ad-actions', style: { marginBottom: 16 } },
              h(Button, { onClick: () => controller.openModelExport(), disabled: reading || Boolean(state.transfer?.checking) }, t('exportModels')),
              h(Button, { onClick: () => transferInput.current?.click(), title: state.sessionId ? t('transferGlobalOnly') : undefined, disabled: Boolean(state.sessionId) || reading || state.busy.save || state.busy.reset || state.busy.changeReceipt || Boolean(state.transfer?.checking) }, t('importModels')),
              h('input', { ref: transferInput, type: 'file', accept: '.json,application/json', hidden: true, 'aria-label': t('importModels'), onChange: event => onImport(event, true) })),
            state.sessionId && h('p', { className: 'ad-help' }, t('transferGlobalOnly')),
            h(ModelTransfer, { state, controller, t, locale, download }),
            h(NewRole, { state, controller, t, locale, exportDraft }),
            h('div', { className: 'ad-layout' }, h('aside', { className: 'ad-sidebar', 'aria-label': t('roles') },
              h('label', { className: 'ad-field ad-search' }, h('span', { className: 'ad-sr' }, t('search')), h('input', { type: 'search', value: search, placeholder: t('searchHint'), onChange: event => setSearch(event.target.value) })),
              h('label', { className: 'ad-field' }, h('span', { className: 'ad-sr' }, t('roleFilter')), h('select', { value: filter, onChange: event => setFilter(event.target.value) }, h('option', { value: 'all' }, t('filterAll')), h('option', { value: 'enabled' }, t('filterEnabled')), h('option', { value: 'unavailable' }, t('filterUnavailable')))),
              h('p', { className: 'ad-help', style: { marginTop: 8 } }, t('count', { count: filtered.length + broken.length })),
              h('ul', { className: 'ad-role-list' }, filtered.map(item => h('li', { key: item.id }, h('button', { type: 'button', className: 'ad-role', 'aria-current': state.selectedId === item.id, onClick: () => controller.select(item.id) }, h('span', { className: 'ad-role-name' }, locale.resolveText(item.title)), h('span', { className: 'ad-role-meta' }, h('span', null, t(item.enabled ? 'enabled' : 'disabled')), h(RoleStatusBadge, { agent: item, sessionSelected: Boolean(state.sessionId), t }), isDirty(state.drafts[item.id]) && h('span', null, t('dirty')))))), broken.map(item => h('li', { key: item.id }, h('button', { type: 'button', className: 'ad-role', 'aria-current': state.selectedId === item.id, onClick: () => controller.select(item.id) }, h('span', { className: 'ad-role-name' }, item.id), h('span', { className: 'ad-role-meta ad-warning' }, t('unavailable')))))),
              !filtered.length && !broken.length && h('p', { className: 'ad-empty' }, t('noRoles'))),
              h(RoleDetail, { state, controller, t, locale, exportDraft }))),
          state.tab === 'runs' && h(Runs, { state, controller, t, locale }),
          state.tab === 'diagnostics' && h('section', { 'aria-label': t('diagnostics') },
            state.catalog?.runtime && h(React.Fragment, null, h('h3', null, t('runtime')), h(Stats, { rows: [[t('compatibilityVersion'), state.catalog.runtime.compatibilityVersion], [t('nativeProvider'), t(state.catalog.runtime.nativeProvider ? 'yes' : 'no')], [t('storage'), t(state.catalog.runtime.storage ? 'yes' : 'no')]] })),
            state.catalog?.runtime?.canCaptureWorkspaceCuts && h('div', { className: 'ad-section' },
              h('p', { className: 'ad-help' }, t('captureWorkspaceHelp')),
              h(Button, { disabled: state.busy.workspaceCapture, onClick: () => controller.captureWorkspaceCuts() }, t('captureWorkspaceCuts')),
              h(ErrorNotice, { value: state.errors.workspaceCapture, t }),
              state.workspaceCapture && h(React.Fragment, null,
                h('p', { role: 'status' }, t('captureWorkspaceResult', { captured: state.workspaceCapture.captured.length, pending: state.workspaceCapture.pending.length })),
                state.workspaceCapture.pending.length > 0 && h('ul', null, state.workspaceCapture.pending.map(item => h('li', { key: item.runId }, `${item.runId}: ${item.reason}`))))),
            h('div', { className: 'ad-section' }, h('h3', null, t('diagnostics')), state.catalog?.diagnostics.length ? h(DiagnosticList, { items: state.catalog.diagnostics, t }) : h('p', { className: 'ad-empty' }, t('noDiagnostics')))))
      );
    }
    return {
      inject: ['slots', 'locale', 'connection'],
      // Pure state and serialization exports allow contract tests without a DOM or a second React runtime.
      modelTransfer, createController, definitionText, formIssues, previewFacts, previewNeedsSession, previewDiagnostics, roleView, roleStatus, selectionOptions, dictionaries,
      apply(ctx) {
        const locale = ctx.get('locale');
        ctx.effect(() => locale.register(NS, 'en', dictionaries.en));
        ctx.effect(() => locale.register(NS, 'zh', dictionaries.zh));
        const Section = () => h(Page, { ctx });
        ctx.slots.inject('settings.section', () => {
          let unregister;
          let active = locale.getSnapshot().active;
          const register = () => {
            unregister?.();
            unregister = ctx.slots.register({ name: 'settings.section', id: 'agentdeck', order: 30, label: locale.bind(NS)('title') }, Section);
          };
          register();
          const unsubscribe = locale.subscribe(() => {
            if (locale.getSnapshot().active !== active) { active = locale.getSnapshot().active; register(); }
          });
          return () => { unsubscribe(); unregister?.(); };
        });
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({ name: 'settings.section.icon', id: 'agentdeck' }, DeckIcon));
      }
    };
  }
});
