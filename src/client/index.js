window.__ModuleLoader__.load({
  id: 'dsh-agentdeck',
  factory(require) {
    'use strict';
    const React = require('react');
    const h = React.createElement;
    const NS = 'agentdeck';
    const dictionaries = /* AGENTDECK_LOCALES */ null;
    const definitionKeys = ['schemaVersion', 'id', 'title', 'description', 'instructions', 'capabilities', 'skills', 'scripts', 'inputs', 'deliverables', 'model', 'reasoning', 'output', 'context', 'enabled', 'extends'];
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
    const validTokens = value => Number.isSafeInteger(value) && value >= 1 && value <= 16777216;
    const validText = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
    const validCandidateId = value => validText(value) && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
    function formIssues(form) {
      if (!form) return [];
      const issues = [];
      if (form.model?.mode === 'fixed' && (!validText(form.model.provider) || !validText(form.model.model))) issues.push({ key: 'invalidRoute' });
      if (form.model?.mode !== 'auto' && form.reasoning?.mode === 'fixed' && !validText(form.reasoning.effort)) issues.push({ key: 'invalidEffort' });
      if (form.output !== undefined && !validTokens(form.output.maxTokens)) issues.push({ key: 'invalidOutput' });
      if (form.context && (!validTokens(form.context.targetTokens) || !validTokens(form.context.elasticTokens) || form.context.targetTokens > form.context.elasticTokens)) issues.push({ key: 'invalidContext' });
      if (form.model?.mode === 'auto') {
        const candidates = form.model.candidates || [];
        if (candidates.length < 1 || candidates.length > 3 || new Set(candidates.map(item => item.id)).size !== candidates.length || !candidates.some(item => item.id === form.model.defaultCandidate)) issues.push({ key: 'invalidCandidates' });
        candidates.forEach((item, index) => {
          if (!validCandidateId(item.id) || !validText(item.purpose) || item.purpose.length > 240 || !validText(item.provider) || !validText(item.model) || !validTokens(item.maxTokens) || !['model-default', 'fixed'].includes(item.reasoning?.mode) || item.reasoning.mode === 'fixed' && !validText(item.reasoning.effort)) issues.push({ key: 'invalidCandidate', number: index + 1 });
        });
      }
      return issues;
    }
    function roleView(agent, preview, defaultRoute = false) {
      if (!agent || preview?.agent?.id !== agent.id || preview.agent.revision !== agent.revision) return agent;
      if (!defaultRoute) return preview.agent;
      // Live capability evidence also updates the list. Its model badge still describes the saved default.
      return { ...preview.agent, authorization: agent.authorization, configuredSelection: agent.configuredSelection,
        available: Boolean(preview.agent.capabilitiesAvailable && agent.authorization?.status === 'authorized') };
    }
    function roleStatus(agent, selectedModel = false) {
      if (!agent.enabled) return 'disabled';
      if (agent.authorization?.status === 'denied') return selectedModel ? 'selectedModelDenied' : 'modelDenied';
      if (agent.missingCapabilities?.length) return 'unavailable';
      if (agent.unverifiedCapabilities?.length) return 'capabilityUnknown';
      if (agent.authorization?.status !== 'authorized') return 'authorizationUnknown';
      return agent.available ? 'available' : 'unavailable';
    }
    // Metadata, authorization and output validation are independent facts, including without a Session.
    function previewFacts(preview, sessionId) {
      return {
        configuredSelection: preview?.configuredSelection,
        effectiveSelection: preview?.effectiveSelection,
        authorization: sessionId ? preview?.authorization || { status: 'unknown' } : { status: 'unknown' },
        output: preview?.output || { source: 'unknown', validated: false },
        capacity: preview?.capacity || { kind: 'unknown', assemblyChecked: false }
      };
    }
    function selectionOptions(selected, items, loaded) {
      return selected && !items.some(item => item.id === selected)
        ? [{ id: selected, name: selected, availability: loaded ? 'unavailable' : 'unknown' }, ...items]
        : items;
    }
    const optionsKey = provider => 'modelOptions:' + JSON.stringify(provider);
    const metadataKey = (provider, model) => 'modelMetadata:' + JSON.stringify([provider, model]);
    function fault(error) {
      return { code: error?.code || 'requestFailed', message: error?.message || String(error), details: error?.details };
    }
    function createController(connection) {
      let disposed = false;
      let state = {
        catalog: null, selectedId: '', sessionId: '', setupSessionId: '', setupCatalog: null, runParentId: '', runParents: [], tab: 'roles', drafts: {},
        evidence: {}, setupOpen: false, setupSeeded: false, setupStale: false,
        setupOptions: { mode: 'inherit', inheritOutputPolicy: { mode: 'preserve' }, fixed: { mode: 'fixed', provider: '', model: '', reasoning: { mode: 'model-default' }, outputPolicy: { mode: 'preserve' } }, auto: { mode: 'auto', candidates: [], defaultCandidate: '' }, proposalGenerator: { provider: '', model: '' }, scopePolicy: 'fill-unconfigured', defaultRoute: { provider: '', model: '' }, imageRoute: { provider: '', model: '' }, includeBrowser: true, browserSeparate: false, resourceMigration: {}, roleIds: [] },
        setupProposal: null, setupSelected: {}, setupPreviewReady: false, setupImpacts: [], setupImpactRevision: null, setupAccepted: {}, setupResult: null, changePreview: null, changeAccepted: {},
        models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, setupModelOptions: {}, preview: null, previewCandidates: {}, runs: null, result: null, resultChild: '', resultStale: false,
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
      const setupModelReads = new Map();
      const publish = patch => {
        if (disposed) return;
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
        const readOnly = ['catalog', 'models', 'modelOptions', 'preview', 'recommend', 'previewSetup', 'previewChange', 'inspectDefinition', 'runs', 'result'].includes(endpoint);
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
      const setupSessionPayload = () => state.setupSessionId ? { sessionId: state.setupSessionId } : {};
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
          publish({ catalog, drafts, selectedId, evidence: {}, ...(!state.sessionId && !state.setupSessionId ? { setupCatalog: catalog } : {}) });
        });
      }
      function select(id) { ensureDraft(id); invalidateChange(); publish({ selectedId: id, creating: false, preview: null, notice: '' }); }
      function edit(id, text) {
        if (!canEdit(id)) return;
        invalidateSetup(); invalidateChange();
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
        invalidateSetup(); invalidateChange();
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
        invalidateSetup(); invalidateChange();
        const form = { ...draft.form, ...patch };
        let actions = draft.actions || [];
        const localValues = patch.context ? Object.entries(patch.context).filter(([key, value]) => value !== draft.form.context[key]) : [];
        for (const [key, value] of localValues) actions = recordDefinitionAction(actions, { path: ['context', key], op: 'set', value });
        for (const [key, value] of Object.entries(patch)) {
          if (key === 'context' && value !== undefined) continue;
          const path = [key];
          const action = key === 'output' && value === undefined
            ? { path, op: 'clear-output' }
            : value === undefined ? { path, op: 'delete' } : { path, op: 'set', value };
          actions = recordDefinitionAction(actions, action);
        }
        if (patch.model?.mode === 'auto' || Object.hasOwn(patch, 'output')) {
          form.schemaVersion = 2;
          actions = recordDefinitionAction(actions, { path: ['schemaVersion'], op: 'set', value: 2 });
        }
        if (form.model?.mode === 'auto' && patch.model?.mode === 'auto') {
          form.reasoning = { mode: 'model-default' };
          delete form.output;
          if (patch.model?.mode === 'auto') actions = recordDefinitionAction(actions, { path: ['output'], op: 'delete' });
          actions = recordDefinitionAction(actions, { path: ['reasoning'], op: 'set', value: form.reasoning });
        }
        if (form.output === undefined) delete form.output;
        publish({ drafts: { ...state.drafts, [id]: { ...draft, form, actions, materialized: false, kind: 'form' } }, notice: '' });
      }
      function setModelMode(id, mode, migration) {
        ensureDraft(id);
        const form = state.drafts[id]?.form;
        if (!form) return;
        const exitingAuto = form.model.mode === 'auto' && mode !== 'auto';
        const candidate = exitingAuto && form.model.candidates.find(item => item.id === migration);
        if (exitingAuto && !candidate && migration !== '@reset') return;
        const route = candidate || (form.model.mode === 'fixed' ? form.model : state.preview?.effectiveSelection || state.preview?.configuredSelection);
        const model = mode === 'auto' ? { mode, defaultCandidate: 'default', candidates: [{ id: 'default', purpose: '', provider: route?.provider || '', model: route?.model || '', reasoning: { mode: 'model-default' }, maxTokens: form.output?.maxTokens ?? state.preview?.model?.defaultMaxTokens ?? '' }] } : mode === 'fixed' ? { mode, provider: route?.provider || '', model: route?.model || '' } : { mode: 'inherit' };
        updateForm(id, { model, reasoning: candidate?.reasoning ?? { mode: mode === 'auto' ? 'model-default' : 'inherit-compatible' }, ...(exitingAuto ? { output: candidate ? { maxTokens: candidate.maxTokens } : undefined } : {}) });
      }
      function updateCandidate(id, index, patch) {
        const model = state.drafts[id]?.form?.model;
        if (model?.mode !== 'auto' || !model.candidates[index]) return;
        const previous = model.candidates[index];
        updateForm(id, { model: { ...model, candidates: model.candidates.map((item, at) => at === index ? { ...item, ...patch } : item), defaultCandidate: model.defaultCandidate === previous.id && patch.id !== undefined ? patch.id : model.defaultCandidate } });
      }
      function addCandidate(id) {
        const model = state.drafts[id]?.form?.model;
        if (model?.mode !== 'auto' || model.candidates.length >= 3) return;
        let candidateId = 'candidate-2';
        for (let number = 2; model.candidates.some(item => item.id === candidateId); number++) candidateId = 'candidate-' + (number + 1);
        updateForm(id, { model: { ...model, candidates: [...model.candidates, { id: candidateId, purpose: '', provider: '', model: '', reasoning: { mode: 'model-default' }, maxTokens: '' }] } });
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
        const text = JSON.stringify({ schemaVersion: findAgent(base)?.schemaVersion ?? 1, id: '', extends: base }, null, 2) + '\n';
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
        const text = JSON.stringify({ schemaVersion: findAgent(base)?.schemaVersion ?? 1, id, extends: base }, null, 2) + '\n';
        publish({ newId: id, newBase: base, identity: null, drafts: { ...state.drafts, '@new': { ...draft, text } } });
        if (id) void inspectNew(text);
      }
      function setNewId(id) { updateNewTemplate(id, state.newBase); }
      function setNewBase(base) { updateNewTemplate(state.newId, base); }
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
        invalidateSetup(); invalidateChange();
        const drafts = { ...state.drafts, [id]: { ...makeDraft(id), text: draft.text, kind: 'raw' } };
        delete drafts['@new'];
        publish({ drafts, creating: false, selectedId: id, notice: 'unsavedImport', preview: null });
        return true;
      }
      async function save(id) {
        if (!canEdit(id)) return { ok: false };
        if (state.busy.save || state.busy.reset || state.busy.applySetup || state.busy.changeReceipt) return { ok: false };
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
        const impacts = preview.impacts || [];
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
        if (state.busy.save || state.busy.reset || state.busy.applySetup || state.busy.changeReceipt) return { ok: false };
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
        const impacts = preview.impacts || [];
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
        if (answer.uncertain) return readChangeReceipt('reset', payload, stored => {
          if (stored) return false;
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
          observed = observe(catalog.overrides.find(item => item.id === payload.id));
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
        invalidateChange();
        const writeSessionId = canEdit(id) ? state.drafts[id]?.writeSessionId : undefined;
        publish({ drafts: { ...state.drafts, [id]: { ...makeDraft(id), writeSessionId } }, errors: { ...state.errors, save: null, reset: null }, notice: '' });
      }
      function acceptProviders(value) {
        publish({ providers: value.providers, providersLoaded: true });
      }
      const setupModelsKey = provider => 'setupModels:' + JSON.stringify(provider);
      function setupModelOptionsState(provider = '') {
        const key = setupModelsKey(provider);
        const loaded = Object.hasOwn(state.setupModelOptions, provider);
        return { items: loaded ? state.setupModelOptions[provider] : [], loaded, busy: Boolean(state.busy[key]), error: state.errors[key] || null };
      }
      function loadSetupModelOptions(provider = '', force = false) {
        const key = setupModelsKey(provider);
        if (!force && setupModelReads.has(key)) return setupModelReads.get(key);
        if (!force && setupModelOptionsState(provider).loaded) return Promise.resolve({ ok: true });
        const work = request(key, 'models', { view: 'setup-options', ...(provider ? { provider } : {}) }, value => {
          if (value.diagnostics?.length) throw { code: 'modelOptionsUnavailable', message: value.diagnostics.join('\n'), details: { provider, diagnostics: value.diagnostics } };
          const items = provider ? value.models : value.providers;
          if (!Array.isArray(items)) throw { code: 'malformedResponse', message: 'malformedResponse' };
          publish({ setupModelOptions: { ...state.setupModelOptions, [provider]: items } });
        });
        setupModelReads.set(key, work);
        void work.then(() => { if (setupModelReads.get(key) === work) setupModelReads.delete(key); });
        return work;
      }
      function loadSetupModels() {
        const { provider } = state.setupOptions.proposalGenerator;
        const directory = loadSetupModelOptions();
        if (!provider || setupModelOptionsState(provider).error) return directory;
        return Promise.all([directory, loadSetupModelOptions(provider)]).then(([result]) => result);
      }
      function cancelSetupModels() {
        setupModelReads.clear();
        const busy = { ...state.busy };
        for (const [key, controller] of requests) {
          if (key.startsWith('setupModels:')) { controller.abort(); requests.delete(key); busy[key] = false; }
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
          cancelSetupModels();
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
        // Setup model reads are independent of the selected role and start after its cancellations.
        if (state.setupOpen && (force || !setupModelOptionsState().error)) reads.push(loadSetupModels());
        return Promise.all(reads);
      }
      async function refresh() {
        if (state.busy.applySetup) return { ok: false };
        refreshing = true;
        cancelModelReads();
        cancelSetupModels();
        requests.get('preview')?.abort(); requests.delete('preview');
        publish({ preview: null, evidence: {}, busy: { ...state.busy, preview: false }, models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, setupModelOptions: {} });
        try {
          const answer = await loadCatalog();
          if (answer.ok && !disposed) {
          refreshing = false;
          await Promise.all([syncReads(true), ...(state.setupOpen ? [loadSetupCatalog()] : [])]);
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
        publish({ sessionId, catalog: null, evidence: {}, models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, preview: null, errors: { ...state.errors, catalog: null, preview: null, models: null }, busy: { ...state.busy, catalog: false, preview: false } });
      }
      function invalidateSetup() {
        for (const key of ['recommend', 'setupPreview']) { requests.get(key)?.abort(); requests.delete(key); }
        publish({ setupStale: Boolean(state.setupProposal), setupSelected: {}, setupPreviewReady: false, setupImpacts: [], setupImpactRevision: null, setupAccepted: {}, errors: { ...state.errors, setupPreview: null }, busy: { ...state.busy, recommend: false, setupPreview: false } });
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
      function setSetupSession(sessionId) {
        if (state.busy.applySetup || state.setupSessionId === sessionId) return;
        invalidateSetup();
        publish({ setupSessionId: sessionId, setupCatalog: null, setupResult: null });
        return loadSetupCatalog();
      }
      function setRunParent(parentId) {
        requests.get('runs')?.abort(); requests.delete('runs');
        api.closeResult();
        publish({ runParentId: parentId, runs: null, busy: { ...state.busy, runs: false }, errors: { ...state.errors, runs: null } });
      }
      function setupProtection(agent, options = state.setupOptions) {
        if (isDirty(state.drafts[agent.id])) return 'draftConflict';
        if (agent.source && !agent.source.startsWith('user:')) return 'setupSourceProtected';
        if (options.scopePolicy !== 'replace-selected' && (state.setupCatalog?.overrides.some(item => item.id === agent.id) || !agent.enabled)) return 'setupProtected';
        return '';
      }
      function updateSetup(patch) {
        if (state.busy.applySetup) return;
        invalidateSetup();
        if (Object.hasOwn(patch, 'proposalGenerator')) error('recommend', null);
        const options = { ...state.setupOptions, ...patch };
        if (patch.defaultRoute) { options.mode = 'fixed'; options.fixed = { ...options.fixed, ...patch.defaultRoute }; }
        // Unlocking replacement never adds roles to the owner's selection.
        if (patch.scopePolicy === 'fill-unconfigured') options.roleIds = options.roleIds.filter(id => { const agent = state.setupCatalog?.agents.find(item => item.id === id); return agent && !setupProtection(agent, options); });
        publish({ setupOptions: options, setupResult: null });
      }
      function seedSetup(catalog) {
        if (state.setupSeeded) return;
        updateSetup({ roleIds: catalog.agents.filter(agent => !setupProtection(agent)).map(agent => agent.id) });
        publish({ setupSeeded: true });
      }
      function loadSetupCatalog() {
        return request('setupCatalog', 'catalog', setupSessionPayload(), catalog => {
          const ids = state.setupOptions.roleIds.filter(id => catalog.agents.some(agent => agent.id === id));
          if (ids.length !== state.setupOptions.roleIds.length) invalidateSetup();
          publish({ setupCatalog: catalog, ...(ids.length !== state.setupOptions.roleIds.length ? { setupOptions: { ...state.setupOptions, roleIds: ids } } : {}) });
          if (state.setupOpen) seedSetup(catalog);
        });
      }
      function openSetup() {
        publish({ setupOpen: true });
        if (state.setupCatalog) seedSetup(state.setupCatalog);
        else void loadSetupCatalog();
        void loadSetupModels();
      }
      function addSetupCandidate() {
        const pool = state.setupOptions.auto;
        if (pool.candidates.length >= 3) return;
        let number = 1;
        while (pool.candidates.some(item => item.id === 'candidate-' + number)) number++;
        updateSetup({ auto: { ...pool, candidates: [...pool.candidates, { id: 'candidate-' + number, purpose: '', provider: '', model: '', reasoning: { mode: 'model-default' }, maxTokens: '' }] } });
      }
      function updateSetupCandidate(id, patch) {
        const pool = state.setupOptions.auto;
        updateSetup({ auto: { ...pool, candidates: pool.candidates.map(item => item.id === id ? { ...item, ...patch } : item) } });
      }
      function removeSetupCandidate(id) {
        const pool = state.setupOptions.auto;
        if (pool.candidates.length <= 1) return;
        updateSetup({ auto: { ...pool, candidates: pool.candidates.filter(item => item.id !== id), defaultCandidate: pool.defaultCandidate === id ? '' : pool.defaultCandidate } });
      }
      async function setSetupCandidateModel(id, model) {
        const item = state.setupOptions.auto.candidates.find(candidate => candidate.id === id);
        if (!item) return { ok: false };
        updateSetupCandidate(id, { model, reasoning: { mode: 'model-default' } });
        const options = state.setupOptions, session = state.setupSessionId;
        const answer = await loadModelMetadata(item.provider, model);
        const metadata = modelMetadataState(item.provider, model).model;
        if (!validTokens(item.maxTokens) && answer.ok && options === state.setupOptions && session === state.setupSessionId && metadata?.metadataResolved && validTokens(metadata.defaultMaxTokens)) updateSetupCandidate(id, { maxTokens: metadata.defaultMaxTokens });
        return answer;
      }
      const setupApplicable = row => row.applicable && (row.status === undefined || row.status === 'changed');
      function acceptSetupImpact(id, checked) {
        if (!state.busy.applySetup && state.setupPreviewReady && state.setupImpacts.some(item => item.id === id)) publish({ setupAccepted: { ...state.setupAccepted, [id]: checked } });
      }
      async function recommendSetup() {
        if (state.busy.applySetup) return { ok: false };
        const options = state.setupOptions;
        const catalog = state.setupCatalog;
        const scope = state.setupSessionId;
        invalidateSetup(); publish({ setupResult: null });
        const strategy = options.mode === 'fixed' ? options.fixed : options.mode === 'explicit-inherit' ? { mode: 'inherit', outputPolicy: options.inheritOutputPolicy } : options.mode === 'manual-auto' || (options.mode === 'auto' && options.auto.candidates.length) ? options.auto : undefined;
        const generator = !strategy && options.proposalGenerator?.provider && options.proposalGenerator.model.trim()
          ? { provider: options.proposalGenerator.provider, model: options.proposalGenerator.model.trim() } : undefined;
        const browserActive = options.includeBrowser && catalog?.agents.some(agent => options.roleIds.includes(agent.id) && agent.capabilities?.some(value => value.startsWith('browser-')));
        const payload = { roleIds: options.roleIds, ...(strategy ? { strategy } : {}), ...(generator ? { generatorRoute: generator } : {}), scopePolicy: options.scopePolicy, includeBrowser: options.includeBrowser,
          ...(options.mode === 'fixed' && browserActive && options.browserSeparate ? { browserStrategy: { mode: 'fixed', ...options.imageRoute } } : {}), resourceMigration: Object.fromEntries(Object.entries(options.resourceMigration).filter(([id]) => options.roleIds.includes(id))) };
        const answer = await request('recommend', 'recommend', { ...payload, ...setupSessionPayload() }, value => {
          if (options !== state.setupOptions || scope !== state.setupSessionId) return;
          publish({ setupProposal: value, setupStale: false, setupProposalScope: scope, setupSelected: Object.fromEntries(value.rows.map(row => [row.id, setupApplicable(row) && !isDirty(state.drafts[row.id])])) });
        }, strategy ? 15000 : 120000);
        if (answer.ok && state.setupProposal === answer.value) await previewSetup();
        return answer;
      }
      async function previewSetup() {
        const proposal = state.setupProposal, selection = state.setupSelected;
        if (!proposal || state.setupStale || state.busy.applySetup) return { ok: false };
        requests.get('setupPreview')?.abort(); requests.delete('setupPreview');
        publish({ setupPreviewReady: false, setupImpacts: [], setupImpactRevision: null, setupAccepted: {}, errors: { ...state.errors, setupPreview: null }, busy: { ...state.busy, setupPreview: false } });
        const rows = proposal.rows.filter(row => selection[row.id] && setupApplicable(row));
        if (!rows.length) {
          publish({ setupProposal: { ...proposal, rows: proposal.rows.map(row => ({ ...row, after: row.before })) }, setupPreviewReady: true });
          return { ok: true };
        }
        return request('setupPreview', 'previewSetup', { rows: rows.map(row => ({ id: row.id, text: row.proposedText, roleRevision: row.roleRevision, ...(row.expectedRevision ? { expectedRevision: row.expectedRevision } : {}) })), ...(proposal.setupPolicy ? { setupPolicy: proposal.setupPolicy } : {}), ...setupSessionPayload() }, value => {
          if (proposal !== state.setupProposal || selection !== state.setupSelected) return;
          if (proposal.rows.some(row => !value.resources?.[row.id]) || proposal.setupPolicy && (!validText(value.impactRevision) || !Array.isArray(value.impacts))) throw { code: 'malformedResponse', message: 'malformedResponse' };
          publish({ setupProposal: { ...proposal, rows: proposal.rows.map(row => ({ ...row, after: value.resources[row.id] })) }, setupPreviewReady: true, setupImpacts: value.impacts || [], setupImpactRevision: value.impactRevision || null, setupAccepted: {} });
        });
      }
      function selectSetup(id, checked) {
        if (state.setupStale || state.busy.applySetup || !state.setupProposal?.rows.some(row => row.id === id && row.applicable) || isDirty(state.drafts[id])) return Promise.resolve({ ok: false });
        publish({ setupSelected: { ...state.setupSelected, [id]: checked }, setupPreviewReady: false });
        return previewSetup();
      }
      async function applySetup() {
        if (state.setupStale || !state.setupPreviewReady || state.busy.setupPreview || state.busy.applySetup || state.busy.save || state.busy.reset) return { ok: false };
        const rows = state.setupProposal?.rows.filter(row => state.setupSelected[row.id] && row.applicable) || [];
        if (!rows.length) return { ok: false };
        if (rows.some(row => isDirty(state.drafts[row.id]))) { error('applySetup', { message: 'draftConflict' }); return { ok: false }; }
        if (state.setupImpacts.some(impact => state.setupAccepted[impact.id] !== true)) return { ok: false };
        const payload = rows.map(row => ({ id: row.id, text: row.proposedText, roleRevision: row.roleRevision, ...(row.expectedRevision ? { expectedRevision: row.expectedRevision } : {}) }));
        const policy = state.setupProposal.setupPolicy;
        if (policy && !state.setupImpactRevision) return { ok: false };
        const acceptance = { ...(policy ? { setupPolicy: policy } : {}), ...(state.setupImpactRevision ? { impactRevision: state.setupImpactRevision, acceptedIndirectRoles: state.setupImpacts.map(impact => impact.id) } : {}) };
        publish({ setupResult: null, setupProposal: null, setupPreviewReady: false, setupImpacts: [], setupAccepted: {}, setupImpactRevision: null });
        const session = state.setupSessionId;
        const answer = await request('applySetup', 'applySetup', { rows: payload, ...acceptance, ...setupSessionPayload() }, value => publish({ setupResult: value }));
        if (disposed || state.setupSessionId !== session) return answer;
        if (!answer.ok && !answer.uncertain) return answer;
        const usesDetailCatalog = session === state.sessionId;
        const readback = await (usesDetailCatalog ? loadCatalog() : loadSetupCatalog());
        if (answer.ok && !disposed && state.setupSessionId === session) {
          if (!usesDetailCatalog) await loadCatalog();
          else if (session) await loadSetupCatalog();
        }
        const initialRows = answer.ok && Array.isArray(answer.value?.rows) ? answer.value.rows : rows.map(row => ({ id: row.id, status: 'uncertain' }));
        const overrides = readback.ok ? readback.value.overrides : [];
        if (!readback.aborted && !disposed && state.setupSessionId === session) {
          const reconciledRows = initialRows.map(row => {
            if (row.status !== 'uncertain') return row;
            const proposed = rows.find(candidate => candidate.id === row.id)?.proposedText;
            const observed = overrides.some(item => item.id === row.id && item.text === proposed);
            if (observed) return { ...row, status: 'observed' };
            return answer.ok ? row : { ...row, status: 'unknown' };
          });
          publish({ setupResult: { status: answer.ok ? answer.value.status : 'reconciled', rows: reconciledRows } });
        }
        return answer;
      }
      function stageSetup(id) {
        const row = state.setupProposal?.rows.find(item => item.id === id);
        if (state.setupStale || !row?.proposedText || isDirty(state.drafts[id])) return;
        const sessionId = state.setupSessionId;
        const changedContext = sessionId !== state.sessionId;
        if (changedContext) setSession(sessionId);
        const baseline = row.currentText ?? '';
        invalidateSetup();
        invalidateChange();
        publish({ setupOpen: false, creating: false, selectedId: id, preview: null, drafts: { ...state.drafts, [id]: { text: row.proposedText, baseline, form: null, kind: 'raw', actions: [], writeSessionId: sessionId, expectedRevision: row.expectedRevision } } });
        if (changedContext) void loadCatalog();
      }
      const clearRunEvidence = childId => state.runs?.map(run => run.childId === childId
        ? { ...run, businessStatus: undefined, businessStatusCheckedAt: undefined } : run) ?? null;
      const api = {
        getSnapshot: () => state,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        activate: () => { disposed = false; },
        dispose: () => { disposed = true; modelGeneration++; for (const controller of requests.values()) controller.abort(); requests.clear(); listeners.clear(); },
        isDisposed: () => disposed,
        set: publish, error, openForm, restoreField, openSetup, updateSetup, setupProtection, addSetupCandidate, updateSetupCandidate, removeSetupCandidate, setSetupCandidateModel, acceptSetupImpact, loadModelMetadata, recommendSetup, previewSetup, selectSetup, applySetup, stageSetup, loadCatalog, select, canEdit, useProjectEdit, edit, updateForm, setModelMode, updateCandidate, addCandidate, removeCandidate, selectPreviewCandidate, beginCreate, setNewId, setNewBase, importText, useExistingDocument, materializeDraft, save, reset, discard, setSession,
        loadModels, loadProviders, loadSetupModels, loadSetupModelOptions, setupModelOptionsState, loadModelOptions, modelOptionsState, modelMetadataState, loadCandidateOptions, loadCandidateMetadata, setCandidateProvider, setCandidateModel, loadPreview, syncReads, refresh, previewChange, acceptChangeImpact, setSetupSession, setRunParent, loadSetupCatalog,
        loadRuns: () => {
          api.closeResult();
          return request('runs', 'runs', runSessionPayload(), value => publish({ runs: value.runs, runParents: value.parentIds || state.runParents }));
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
            const result = continuation ? { ...value, rawText: previous.rawText + value.rawText } : value;
            const runs = state.runs?.map(run => run.childId === childId ? { ...run, businessStatus: result.status, businessStatusCheckedAt: continuation ? run.businessStatusCheckedAt : new Date().toISOString() } : run) ?? null;
            publish({ result, resultStale: false, runs });
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
.ad-candidates{margin-top:14px}.ad-candidate{border:0;border-top:1px solid var(--dsw-alias-border-l1);padding:12px 0 16px;margin:16px 0 0;min-width:0}.ad-candidate legend{font-weight:500;padding-right:8px}.ad-candidate .ad-fields{margin-top:0;margin-bottom:10px}
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
      const message = known ? t(dictionaries.en[value.message] ? value.message : value.code) : t('requestFailed');
      return h('div', { className: 'ad-alert ad-error', role: 'alert' },
        save && h('p', null, t('saveError')), h('p', null, message),
        !known && h(CodeDetail, { title: t('originalDiagnostic'), value: value.message }),
        value.code && !dictionaries.en[value.code] && h('code', null, value.code),
        value.details && h('details', null, h('summary', null, t('errorDetails')), h('pre', null, JSON.stringify(value.details, null, 2))),
        retry && h(Button, { onClick: retry }, t('retry')));
    }
    function DiagnosticList({ items, t }) {
      if (!items?.length) return null;
      return h('ul', { className: 'ad-list ad-warning' }, items.map((item, index) => h('li', { key: index }, typeof item !== 'string' && dictionaries.en[item.code] ? h(React.Fragment, null, t(item.code, item.params), item.original && h(CodeDetail, { title: t('originalDiagnostic'), value: item.original })) : h('details', null, h('summary', null, [item.id, item.source, t('diagnosticNotice')].filter(Boolean).join(' · ')), h('pre', null, typeof item === 'string' ? item : item.message)))));
    }
    function CodeDetail({ title, value }) {
      if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return null;
      return h('details', { className: 'ad-details' }, h('summary', null, title), h('pre', null, typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
    }
    const modelModeKey = draft => draft.form?.model?.mode;
    function ModelControls({ state, controller, agent, draft, t }) {
      const form = draft?.form;
      const locked = !controller.canEdit(agent.id) || !form || (isDirty(draft) && draft.kind === 'raw');
      const disabled = locked || state.busy.save || state.busy.applySetup;
      const [migration, setMigration] = React.useState('');
      React.useEffect(() => setMigration(''), [agent.id, modelModeKey(draft)]);
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
      const optionLabel = item => item.availability ? t(item.availability === 'unavailable' ? 'unavailableOption' : 'uncheckedOption', { value: item.name || item.id }) : item.name || item.id;
      const providerOptions = selected => selectionOptions(selected, providers, state.providersLoaded).map(item => h('option', { key: item.id, value: item.id }, optionLabel(item)));
      const set = patch => controller.updateForm(agent.id, patch);
      const field = name => ({ id: 'agentdeck-' + agent.id + '-' + name, name });
      const authorization = !state.sessionId ? 'unknown' : previewMatches ? facts.authorization.status : exact?.authorized === true ? 'authorized' : exact?.authorized === false ? 'denied' : 'unknown';
      const savedCandidates = agent.model.mode === 'auto' ? agent.model.candidates : [];
      const selectedCandidate = savedCandidates.some(item => item.id === state.previewCandidates[agent.id]) ? state.previewCandidates[agent.id] : agent.model.defaultCandidate;
      const issues = draft.kind === 'form' ? formIssues(form) : [];
      return h('section', { className: 'ad-section', 'aria-label': t('model') },
        h('h4', null, t('model')),
        locked && h('p', { className: 'ad-help ad-warning' }, t('yamlLocked')),
        auto && !locked && h(Field, { label: t('autoExitMigration') }, h('select', { value: migration, disabled, onChange: event => setMigration(event.target.value) }, h('option', { value: '' }, t('setupMigrationRequired')), h('option', { value: '@reset' }, t('setupMigrationReset')), model.candidates.map(item => h('option', { key: item.id, value: item.id }, item.id + ' · ' + item.maxTokens)))),
        h('div', { className: 'ad-fields' },
          h(Field, { label: t('modelMode') }, h('select', { ...field('model-mode'), value: model.mode, disabled, onChange: event => controller.setModelMode(agent.id, event.target.value, migration) }, h('option', { value: 'inherit', disabled: auto && !migration }, t('inherit')), h('option', { value: 'fixed', disabled: auto && !migration }, t('fixed')), h('option', { value: 'auto' }, t('auto')))),
          fixed && h(Field, { label: t('provider') }, h('select', { ...field('provider'), value: model.provider || '', disabled, onFocus: () => controller.loadProviders(), onChange: event => set({ model: { mode: 'fixed', provider: event.target.value, model: '' }, reasoning: { mode: 'inherit-compatible' } }) }, h('option', { value: '' }, t('chooseProvider')), providerOptions(model.provider))),
          fixed && h(Field, { label: t('model') }, h('select', { ...field('model'), value: model.model || '', disabled: disabled || !model.provider, 'aria-busy': optionState.busy, onFocus: () => controller.loadModelOptions(model.provider), onChange: event => set({ model: { ...model, model: event.target.value }, reasoning: { mode: 'inherit-compatible' } }) }, h('option', { value: '' }, optionState.busy ? t('loading') : t('chooseModel')), selectionOptions(model.model, options, optionState.loaded).map(item => h('option', { key: item.id, value: item.id }, optionLabel(item))))),
          !auto && h(Field, { label: t('effortMode') }, h('select', { ...field('effort-mode'), value: reasoning.mode, disabled, onChange: event => set({ reasoning: event.target.value === 'fixed' ? { mode: 'fixed', effort: '' } : { mode: event.target.value } }) }, h('option', { value: 'inherit-compatible' }, t('inheritEffort')), h('option', { value: 'model-default' }, t('defaultEffort')), h('option', { value: 'fixed' }, t('fixedEffort')))),
          !auto && reasoning.mode === 'fixed' && h(Field, { label: t('effort') }, h('select', { ...field('effort'), value: reasoning.effort || '', disabled: disabled || metadata.busy || !exact?.metadataResolved, onChange: event => set({ reasoning: { mode: 'fixed', effort: event.target.value } }) }, h('option', { value: '' }, t('chooseEffort')), reasoning.effort && !exact?.efforts?.some(item => item.id === reasoning.effort) && h('option', { value: reasoning.effort }, reasoning.effort), exact?.efforts?.map(item => h('option', { key: item.id, value: item.id, title: item.description }, item.name || item.id)))),
          !auto && h(Field, { label: t('outputCap'), help: t('outputCapHint') }, h('input', { ...field('output-cap'), type: 'number', min: 1, max: 16777216, step: 1, value: form?.output?.maxTokens ?? '', disabled, onChange: event => set({ output: event.target.value === '' ? undefined : { maxTokens: Number(event.target.value) } }) })),
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
                item.reasoning.mode === 'fixed' && h(Field, { label: t('effort') }, h('select', { ...candidateField('effort'), value: item.reasoning.effort || '', disabled: !item.provider || !item.model || candidateMetadata.busy, 'aria-busy': candidateMetadata.busy, onFocus: () => controller.loadCandidateMetadata(agent.id, index), onChange: event => { if (candidateMetadata.model?.metadataResolved) update({ reasoning: { mode: 'fixed', effort: event.target.value } }); } }, h('option', { value: '' }, candidateMetadata.busy ? t('loading') : t('chooseEffort')), selectionOptions(item.reasoning.effort, efforts, Boolean(candidateMetadata.model?.metadataResolved)).map(effort => h('option', { key: effort.id, value: effort.id, title: effort.description }, optionLabel(effort))))),
                h(Field, { label: t('outputCap') }, h('input', { ...candidateField('cap'), type: 'number', min: 1, max: 16777216, step: 1, value: item.maxTokens, onChange: event => update({ maxTokens: event.target.value === '' ? '' : Number(event.target.value) }) }))),
              candidateOptions.loaded && !candidateOptions.items.length && h('p', { className: 'ad-help' }, t('noModelOptions')),
              h(ErrorNotice, { value: candidateOptions.error, t, retry: () => controller.loadCandidateOptions(agent.id, index, true) }),
              h(ErrorNotice, { value: metadataError, t, retry: () => controller.loadCandidateMetadata(agent.id, index, true) }),
              h(Button, { disabled: disabled || model.candidates.length <= 1, 'aria-label': t('removeCandidate') + ': ' + (item.id || index + 1), onClick: () => controller.removeCandidate(agent.id, index) }, t('removeCandidate')));
          }),
          h(Button, { disabled: disabled || model.candidates.length >= 3, onClick: () => controller.addCandidate(agent.id) }, t('addCandidate'))),
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
          [t('authorization'), t({ authorized: 'authorized', denied: 'denied' }[authorization] || 'authorizationUnknown')],
          [t('contextWindow'), exact?.contextWindow ?? t('unknown')],
          [t('maxOutput'), exact?.defaultMaxTokens ?? t('unknown')],
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
      const invalidForm = draft.kind === 'form' && formIssues(form).length > 0;
      const yamlPending = Boolean(draft.actions?.length && !draft.materialized);
      const change = state.changePreview?.draftId === state.selectedId ? state.changePreview : null;
      const resetCustom = agent && !agent.builtin;
      return h('article', { className: 'ad-detail' },
        h('div', { className: 'ad-detail-head' }, h('div', null,
          h('h3', null, agent ? localized(agent.title) : state.selectedId),
          h('div', { className: 'ad-role-meta' }, h('code', null, state.selectedId), agent && h('span', null, t(agent.builtin ? 'builtin' : 'custom')), override && h('span', null, t('override')))),
          h('div', { className: 'ad-actions' }, agent && h(Button, { disabled: readOnly, onClick: () => controller.beginCreate(agent.id) }, t('derive')), h(Button, { onClick: () => exportDraft(state.selectedId) }, t('export')))),
        agent && h('p', { className: 'ad-detail-desc' }, localized(agent.description)),
        (readOnly || draft.writeSessionId) && h('div', { className: 'ad-actions' },
          h('p', { className: 'ad-help', role: 'status' }, t(readOnly ? dirty ? 'draftScopeMismatch' : 'projectReadOnly' : 'projectWriteBound', { session: draft.writeSessionId || t('noSession') })),
          readOnly && !dirty && state.sessionId && h(Button, { onClick: () => controller.useProjectEdit(state.selectedId) }, t('useProjectEdit'))),
        agent && h('div', { className: 'ad-tags' },
          h('span', { className: agent.available ? 'ad-status' : 'ad-warning' }, t(roleStatus(agent, true))),
          h('span', { className: 'ad-tag' }, t('revision') + ' ' + agent.revision.slice(0, 12)),
          agent.id === 'general' && h('span', { className: 'ad-tag' }, t('generalFallback'))),
        agent?.missingCapabilities.length > 0 && h('p', { className: 'ad-warning' }, t('missing', { items: agent.missingCapabilities.map(id => t('cap.' + id)).join(', ') })),
        agent?.unverifiedCapabilities?.length > 0 && h('p', { className: 'ad-help' }, t('capabilityPending', { items: agent.unverifiedCapabilities.map(id => t('cap.' + id)).join(', ') })),
        agent?.browserSupport && h('p', { className: 'ad-help' }, t('browserSupport') + ': ' + t({ ready: 'browserReady', unverified: 'browserUnverified', unsupported: 'browserUnsupported' }[agent.browserSupport.state] || 'unknown') + ' · ' + t({ ready: 'browserReadyHint', unverified: 'browserUnverifiedHint', unsupported: 'browserUnsupportedHint' }[agent.browserSupport.state] || 'browserUnverifiedHint')),
        agent?.browserSupport?.reason && h(CodeDetail, { title: t('originalDiagnostic'), value: agent.browserSupport.reason }),
        agent && h('div', { className: 'ad-section' },
          h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', role: 'switch', 'aria-checked': form?.enabled ?? agent.enabled, checked: form?.enabled ?? agent.enabled, disabled: locked || state.busy.save || state.busy.applySetup, onChange: event => controller.updateForm(agent.id, { enabled: event.target.checked }) }), h('span', null, t((form?.enabled ?? agent.enabled) ? 'enabled' : 'disabled'))),
          h('p', { className: 'ad-help' }, t('newStarts'))),
        agent && h(ModelControls, { state, controller, agent, draft, t }),
        agent && h('section', { className: 'ad-section', 'aria-label': t('budget') },
          h('h4', null, t('budget')), h('p', { className: 'ad-help' }, t('budgetHint')),
          h('div', { className: 'ad-fields' },
            h(Field, { label: t('target') }, h('input', { type: 'number', min: 1, max: 16777216, step: 1, value: form?.context.targetTokens ?? agent.context.targetTokens, disabled: locked || state.busy.save || state.busy.applySetup, onChange: event => controller.updateForm(agent.id, { context: { ...form.context, targetTokens: event.target.value === '' ? '' : Number(event.target.value) } }) })),
            h(Field, { label: t('elastic') }, h('input', { type: 'number', min: 1, max: 16777216, step: 1, value: form?.context.elasticTokens ?? agent.context.elasticTokens, disabled: locked || state.busy.save || state.busy.applySetup, onChange: event => controller.updateForm(agent.id, { context: { ...form.context, elasticTokens: event.target.value === '' ? '' : Number(event.target.value) } }) }))),
          dirty && h('p', { className: 'ad-help ad-warning' }, t('previewDraft')),
          h(ErrorNotice, { value: state.errors.preview, t, retry: () => controller.loadPreview(agent.id) }),
          state.busy.preview && h('p', { role: 'status', className: 'ad-help' }, t('loading')),
          preview && h(Stats, { rows: [[t('target'), preview.budget.targetTokens], [t('elastic'), preview.budget.elasticTokens], [t('safeInput'), preview.budget.safeInputTokens ?? t('unknown')], [t('headroom'), preview.budget.headroomTokens], [t('material'), preview.budget.materialTokens ?? t('unknown')],
            [t('configuredOutput'), facts.output.configuredMaxTokens ?? t('none')],
            [t('effectiveOutput'), facts.output.validated ? facts.output.effectiveMaxTokens ?? t('unknown') : t('unknown')],
            [t('outputSource'), t({ candidate: 'sourceCandidate', role: 'sourceRole', parent: 'sourceParent', 'native-default': 'sourceNative' }[facts.output.source] || 'unknown')],
            [t('outputValidated'), t(facts.output.validated ? 'validationPassed' : 'validationPending')],
            [t('capacity'), t({ configured: 'capacityConfigured', 'validated-parameters': 'capacityValidated' }[facts.capacity.kind] || 'unknown')]] }),
          preview && !preview.budget.known && !preview.model?.contextWindow && h('p', { className: 'ad-help' }, t('unknownBudget')),
          preview && !facts.output.validated && h('p', { className: 'ad-help' }, t('outputPending')),
          h('p', { className: 'ad-help' }, t('assemblyPending')),
          h(DiagnosticList, { items: [...(preview?.budget.diagnostics || []), ...(preview?.diagnostics || [])], t })),
        h('section', { className: 'ad-section', 'aria-label': t('yaml') },
          h(ChangeReview, { change, state, controller, t, locale }),
          h(ErrorNotice, { value: state.errors.changePreview, t }),
          !readOnly && dirty && draft.kind === 'raw' && agent && h(Button, { disabled: state.busy.changePreview || state.busy.save, onClick: () => controller.openForm(agent.id) }, t('openValidatedForm')),
          agent && !locked && override && h('details', { className: 'ad-details' }, h('summary', null, t('restoreFields')), h('div', { className: 'ad-actions' },
            [['model', 'clearLocalModel'], ['reasoning', 'reasoning'], ['output', 'configuredOutput'], ['context', 'clearLocalContext'], ['enabled', 'enabled']].map(([field, label]) => h(Button, { key: field, disabled: state.busy.changePreview || state.busy.save, onClick: () => controller.restoreField(agent.id, field) }, t(label))))),
          yamlPending && h(Button, { disabled: invalidForm || state.busy.changePreview, onClick: () => controller.materializeDraft(state.selectedId) }, t(state.busy.changePreview ? 'loading' : 'previewChange')),
          h('label', { className: 'ad-field' }, h('span', null, t('yaml')), h('span', { className: 'ad-help' }, t('yamlHint')),
            h('textarea', { className: 'ad-yaml', value: draft.text, spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off', readOnly, disabled: yamlPending || state.busy.applySetup, onChange: event => controller.edit(state.selectedId, event.target.value) })),
          h(ErrorNotice, { value: state.errors.save, t, save: true }), h(ErrorNotice, { value: state.errors.reset, t }),
          h('div', { className: 'ad-savebar' }, h('span', { className: 'ad-help', role: 'status' }, dirty ? t('dirty') : ''), h('div', { className: 'ad-actions' },
            dirty && h(Button, { disabled: state.busy.save || state.busy.reset || state.busy.applySetup, onClick: event => openConfirmation(event, 'discard') }, t('discard')),
            h(Button, { primary: true, disabled: readOnly || !dirty || invalidForm || state.busy.save || state.busy.reset || state.busy.applySetup, onClick: () => controller.save(state.selectedId) }, t(state.busy.save ? 'saving' : 'save')))),
          override && !readOnly && h('div', { className: 'ad-actions', style: { marginTop: 12 } }, h(Button, { danger: true, disabled: state.busy.save || state.busy.reset || state.busy.applySetup, onClick: event => { openConfirmation(event, 'reset'); void controller.previewChange(state.selectedId, true); } }, t(resetCustom ? 'deleteCustom' : 'reset'))),
          confirmation && h('div', { className: 'ad-inline-confirm' }, h('p', null, t(confirmation === 'discard' ? 'discardConfirm' : resetCustom ? 'deleteConfirm' : 'resetConfirm')), h('div', { className: 'ad-actions' }, h(Button, { danger: true, disabled: (confirmation === 'reset' && readOnly) || state.busy.save || state.busy.reset || state.busy.applySetup, onClick: () => { if (confirmation === 'discard') { controller.discard(state.selectedId); closeConfirmation(); } else controller.reset(state.selectedId).then(answer => { if (answer.ok && !controller.isDisposed()) closeConfirmation(); }); } }, t(confirmation === 'discard' ? 'discard' : resetCustom ? 'confirmDelete' : 'confirmReset')), h(Button, { buttonRef: cancelButton, onClick: closeConfirmation }, t('cancel'))))),
        agent && h('section', { className: 'ad-section', 'aria-label': t('scope') }, h('h4', null, t('scope')),
          h(Stats, { rows: [[t('capabilities'), agent.capabilities.map(id => t('cap.' + id)).join(', ') || t('none')], [t('skills'), agent.presentation?.skills.map(skill => localized(skill.title)).join(', ') || agent.skills.join(', ') || t('none')], [t('scripts'), agent.scripts.join(', ') || t('none')]] }),
          agent.presentation?.skills.map(skill => h('p', { key: skill.id, className: 'ad-help' }, localized(skill.title) + ' · ' + localized(skill.description))),
          h(CodeDetail, { title: t('inputs'), value: agent.presentation?.inputs.map(localized) || agent.inputs }), h(CodeDetail, { title: t('deliverables'), value: agent.presentation?.deliverables.map(localized) || agent.deliverables }), h(CodeDetail, { title: t('instructions'), value: agent.instructions }))
      );
    }
    function SetupPanel({ state, controller, t, locale }) {
      if (!state.setupOpen) return null;
      const options = state.setupOptions, proposal = state.setupProposal;
      const busy = Boolean(state.busy.applySetup);
      const agents = state.setupCatalog?.agents || [];
      const browserActive = options.includeBrowser && agents.some(agent => options.roleIds.includes(agent.id) && agent.capabilities.some(value => value.startsWith('browser-')));
      const eligible = agents.filter(agent => !controller.setupProtection(agent));
      const selected = proposal?.rows.filter(row => state.setupSelected[row.id] && row.applicable).length || 0;
      const pendingAcceptance = state.setupImpacts.some(impact => state.setupAccepted[impact.id] !== true);
      const proposalGenerator = options.proposalGenerator || { provider: '', model: '' };
      const strategyIssues = options.mode === 'fixed' ? formIssues({ model: options.fixed, reasoning: options.fixed.reasoning, ...(options.fixed.outputPolicy.mode === 'set' ? { output: { maxTokens: options.fixed.outputPolicy.maxTokens } } : {}) }) : [];
      const manual = options.mode === 'manual-auto' || options.mode === 'auto' && options.auto.candidates.length;
      const usesAi = !manual && !['fixed', 'explicit-inherit'].includes(options.mode);
      const generatorProviders = controller.setupModelOptionsState();
      const generatorOptions = controller.setupModelOptionsState(proposalGenerator.provider);
      const generatorMissing = usesAi && (!proposalGenerator.provider || !proposalGenerator.model.trim());
      const picker = (route, update, chooseModel) => {
        const choices = controller.modelOptionsState(route.provider);
        const exact = controller.modelMetadataState(route.provider, route.model);
        const list = selectionOptions(route.model, choices.items, choices.loaded);
        return h(React.Fragment, null,
          h('div', { className: 'ad-fields' },
            h(Field, { label: t('provider') }, h('select', { value: route.provider, disabled: busy, onFocus: () => controller.loadProviders(), onChange: event => { update({ provider: event.target.value, model: '', reasoning: { mode: 'model-default' } }); void controller.loadModelOptions(event.target.value); } }, h('option', { value: '' }, t('chooseProvider')), selectionOptions(route.provider, state.providers, state.providersLoaded).map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)))),
            h(Field, { label: t('model') }, h('select', { value: route.model, disabled: busy || !route.provider, 'aria-busy': choices.busy, onFocus: () => controller.loadModelOptions(route.provider), onChange: event => { if (chooseModel) void chooseModel(event.target.value); else { update({ model: event.target.value, reasoning: { mode: 'model-default' } }); void controller.loadModelMetadata(route.provider, event.target.value); } } }, h('option', { value: '' }, choices.busy ? t('loading') : t('chooseModel')), list.map(item => h('option', { key: item.id, value: item.id }, item.availability ? t(item.availability === 'unavailable' ? 'unavailableOption' : 'uncheckedOption', { value: item.name || item.id }) : item.name || item.id))))),
          h(ErrorNotice, { value: choices.error, t, retry: () => controller.loadModelOptions(route.provider, true) }),
          h(ErrorNotice, { value: exact.error, t, retry: () => controller.loadModelMetadata(route.provider, route.model, true) }));
      };
      const effort = (value, route, update) => {
        const exact = controller.modelMetadataState(route.provider, route.model).model;
        return h(Field, { label: t('effort') }, h('select', { value: value.mode === 'fixed' ? value.effort : '', disabled: busy, onFocus: () => { if (route.provider && route.model) void controller.loadModelMetadata(route.provider, route.model); }, onChange: event => update(event.target.value ? { mode: 'fixed', effort: event.target.value } : { mode: 'model-default' }) }, h('option', { value: '' }, t('defaultEffort')), selectionOptions(value.mode === 'fixed' ? value.effort : '', exact?.efforts || [], Boolean(exact?.metadataResolved)).map(item => h('option', { key: item.id, value: item.id }, item.name || item.id))));
      };
      const outputControls = (policy, update) => h(React.Fragment, null,
        h(Field, { label: t('setupOutputPolicy') }, h('select', { value: policy.mode, disabled: busy, onChange: event => update({ mode: event.target.value }) }, ['preserve', 'set', 'clear'].map(mode => h('option', { key: mode, value: mode }, t('setupOutput.' + mode))))),
        policy.mode === 'set' && h(Field, { label: t('maxOutput') }, h('input', { type: 'number', min: 1, max: 16777216, required: true, disabled: busy, value: policy.maxTokens ?? '', onChange: event => update({ mode: 'set', maxTokens: event.target.value === '' ? '' : Number(event.target.value) }) })));
      const resourceText = value => {
        if (!value) return t('unknown');
        const reasoning = item => item?.mode === 'fixed' ? item.effort : t(item?.mode === 'inherit-compatible' ? 'inherit' : 'defaultEffort');
        const model = value.model;
        if (model.mode === 'auto') return t('auto') + ' · ' + t('defaultCandidate') + ': ' + model.defaultCandidate + ' · ' + model.candidates.map(item => item.id + ' · ' + item.purpose + ' (' + item.provider + '/' + item.model + ', ' + reasoning(item.reasoning) + ', ' + item.maxTokens + ')').join('; ');
        return (model.mode === 'fixed' ? model.provider + '/' + model.model : t('inherit')) + ' · ' + reasoning(value.reasoning) + ' · ' + t('maxOutput') + ': ' + (value.output?.maxTokens ?? t('inherit'));
      };
      const impactResources = (impact, scope, params) => h('div', null,
        scope && h('p', { className: 'ad-help' }, t(scope, params)),
        h(Stats, { rows: [[t('setupBefore'), resourceText(impact.before)], [t('setupAfter'), resourceText(impact.after)],
          ...(impact.before && impact.after ? [[t('target'), impact.before.context.targetTokens + ' → ' + impact.after.context.targetTokens],
            [t('elastic'), impact.before.context.elasticTokens + ' → ' + impact.after.context.elasticTokens]] : [])] }),
        h(CodeDetail, { title: t('setupPrefixImpacts'), value: impact.prefixes }));
      return h('section', { className: 'ad-new', 'aria-label': t('setupTitle') },
        h('div', { className: 'ad-detail-head' }, h('h3', null, t('setupTitle')), h(Button, { disabled: busy, onClick: () => controller.set({ setupOpen: false }) }, t('close'))),
        h(SessionField, { id: 'agentdeck-setup-session', label: t('setupSession'), help: t('setupSessionHint'), value: state.setupSessionId, sessions: state.setupCatalog?.sessions || state.catalog?.sessions || [], empty: t('noSession'), disabled: busy, onChange: value => controller.setSetupSession(value) }),
        h(ErrorNotice, { value: state.errors.setupCatalog, t, retry: () => controller.loadSetupCatalog() }),
        state.busy.setupCatalog && h('p', { role: 'status', className: 'ad-help' }, t('loading')),
        h('p', { className: 'ad-help' }, t('setupStrategyHint')),
        h(Field, { label: t('setupStrategy') }, h('select', { value: options.mode, disabled: busy, onChange: event => controller.updateSetup({ mode: event.target.value }) }, ['inherit', 'fixed', 'explicit-inherit', 'manual-auto'].map(mode => h('option', { key: mode, value: mode }, t('setupMode.' + mode))))),
        options.mode === 'inherit' && h('p', { className: 'ad-help' }, t('setupInheritHint')),
        !proposal && h('p', { className: 'ad-help' }, t('setupScopeSummary', { selected: options.roleIds.length, protected: agents.filter(agent => controller.setupProtection(agent)).length })),
        options.mode === 'fixed' && h('fieldset', { className: 'ad-candidate', disabled: busy }, h('legend', null, t('setupMode.fixed')),
          picker(options.fixed, patch => controller.updateSetup({ fixed: { ...options.fixed, ...patch } })),
          h('details', { className: 'ad-details', open: options.fixed.outputPolicy.mode !== 'preserve' || options.fixed.reasoning.mode === 'fixed' }, h('summary', null, t('setupAdvanced')),
            effort(options.fixed.reasoning, options.fixed, reasoning => controller.updateSetup({ fixed: { ...options.fixed, reasoning } })),
            outputControls(options.fixed.outputPolicy, outputPolicy => controller.updateSetup({ fixed: { ...options.fixed, outputPolicy } })))),
        options.mode === 'explicit-inherit' && outputControls(options.inheritOutputPolicy, value => controller.updateSetup({ inheritOutputPolicy: value })),
        manual && h('fieldset', { className: 'ad-candidate', disabled: busy },
          h('legend', null, t('setupMode.manual-auto')),
          options.auto.candidates.map(item => h('div', { key: item.id },
            h(Field, { label: t('candidateId') }, h('input', { value: item.id, onChange: event => { const id = event.target.value; controller.updateSetup({ auto: { ...options.auto, candidates: options.auto.candidates.map(candidate => candidate === item ? { ...candidate, id } : candidate), defaultCandidate: options.auto.defaultCandidate === item.id ? id : options.auto.defaultCandidate } }); } })),
            h(Field, { label: t('candidatePurpose') }, h('input', { value: item.purpose, onChange: event => controller.updateSetupCandidate(item.id, { purpose: event.target.value }) })),
            picker(item, patch => controller.updateSetupCandidate(item.id, patch), model => controller.setSetupCandidateModel(item.id, model)),
            effort(item.reasoning, item, reasoning => controller.updateSetupCandidate(item.id, { reasoning })),
            h(Field, { label: t('maxOutput') }, h('input', { type: 'number', min: 1, max: 16777216, value: item.maxTokens, onChange: event => controller.updateSetupCandidate(item.id, { maxTokens: event.target.value === '' ? '' : Number(event.target.value) }) })),
            h(Button, { disabled: options.auto.candidates.length <= 1, onClick: () => controller.removeSetupCandidate(item.id) }, t('removeCandidate')))),
          h(Button, { disabled: options.auto.candidates.length >= 3, onClick: controller.addSetupCandidate }, t('addCandidate')),
          h(Field, { label: t('defaultCandidate') }, h('select', { value: options.auto.defaultCandidate, onChange: event => controller.updateSetup({ auto: { ...options.auto, defaultCandidate: event.target.value } }) }, h('option', { value: '' }, t('setupChooseDefault')), options.auto.candidates.map(item => h('option', { key: item.id, value: item.id }, item.id))))),
        usesAi && h('fieldset', { className: 'ad-candidate', disabled: busy },
          h('legend', null, t('setupAiGenerator')),
          options.mode === 'auto' && h('p', { className: 'ad-help' }, t('setupAutoHint')),
          h('p', { className: 'ad-help', role: 'status' }, t('setupAiProposalHint')),
          h('p', { className: 'ad-help' }, t('setupAiGeneratorHint')),
          h('div', { className: 'ad-fields' },
            h(Field, { label: t('provider') }, h('select', {
              value: proposalGenerator.provider, 'aria-busy': generatorProviders.busy,
              onChange: event => {
                const provider = event.target.value;
                controller.updateSetup({ proposalGenerator: { provider, model: '' } });
                if (provider) void controller.loadSetupModelOptions(provider);
              },
            }, h('option', { value: '' }, t(generatorProviders.busy ? 'loading' : 'chooseProvider')),
            selectionOptions(proposalGenerator.provider, generatorProviders.items, generatorProviders.loaded).map(item => h('option', { key: item.id, value: item.id }, item.name || item.id)))),
            h(Field, { label: t('model') }, h('input', {
              type: 'text', list: 'agentdeck-setup-generator-models', value: proposalGenerator.model, disabled: !proposalGenerator.provider,
              'aria-busy': Boolean(proposalGenerator.provider) && generatorOptions.busy,
              placeholder: t('setupGeneratorModelPlaceholder'),
              onFocus: () => { if (proposalGenerator.provider && !generatorOptions.error) void controller.loadSetupModelOptions(proposalGenerator.provider); },
              onChange: event => controller.updateSetup({ proposalGenerator: { ...proposalGenerator, model: event.target.value } }),
            }))),
          h('datalist', { id: 'agentdeck-setup-generator-models' }, proposalGenerator.provider && generatorOptions.items.map(item => h('option', { key: item.id, value: item.id, label: item.name || item.id }))),
          h(ErrorNotice, { value: generatorProviders.error, t, retry: () => controller.loadSetupModelOptions('', true) }),
          proposalGenerator.provider && h(ErrorNotice, { value: generatorOptions.error, t, retry: () => controller.loadSetupModelOptions(proposalGenerator.provider, true) })),
        h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: options.includeBrowser, disabled: busy, onChange: event => controller.updateSetup({ includeBrowser: event.target.checked }) }), t('setupBrowser')),
        options.mode === 'fixed' && browserActive && h('details', { className: 'ad-details' }, h('summary', null, t('setupImageModel')),
          h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: options.browserSeparate, disabled: busy, onChange: event => controller.updateSetup({ browserSeparate: event.target.checked }) }), t('setupBrowserSeparate')),
          options.browserSeparate && picker(options.imageRoute, patch => controller.updateSetup({ imageRoute: { ...options.imageRoute, ...patch } }))),
        h('details', { className: 'ad-details' }, h('summary', null, t('setupScope', { count: options.roleIds.length })),
          h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: options.scopePolicy === 'replace-selected', disabled: busy, onChange: event => controller.updateSetup({ scopePolicy: event.target.checked ? 'replace-selected' : 'fill-unconfigured' }) }), t('setupReplace')),
          h('p', { className: 'ad-help' }, t('setupProtectHint')),
          h(Button, { disabled: busy, onClick: () => controller.updateSetup({ roleIds: eligible.length && eligible.every(agent => options.roleIds.includes(agent.id)) ? [] : eligible.map(agent => agent.id) }) }, t('setupToggleAll')),
          h('div', { className: 'ad-fields' }, agents.map(agent => { const protectedBy = controller.setupProtection(agent); return h('label', { className: 'ad-check', key: agent.id }, h('input', { type: 'checkbox', disabled: busy || Boolean(protectedBy), checked: options.roleIds.includes(agent.id), onChange: event => controller.updateSetup({ roleIds: event.target.checked ? [...options.roleIds, agent.id] : options.roleIds.filter(id => id !== agent.id) }) }), locale.resolveText(agent.title), protectedBy && h('span', { className: 'ad-help' }, ' · ' + t(protectedBy))); }))),
        agents.filter(agent => options.roleIds.includes(agent.id) && agent.model.mode === 'auto' && options.mode === 'fixed' && (options.includeBrowser || !agent.capabilities.some(value => value.startsWith('browser-')))).map(agent => h(Field, { key: agent.id, label: t('setupMigration', { role: locale.resolveText(agent.title) }), help: t('setupMigrationHint') }, h('select', { value: options.resourceMigration[agent.id]?.mode === 'candidate' ? options.resourceMigration[agent.id].candidateId : options.resourceMigration[agent.id]?.mode === 'reset' ? '@reset' : '', disabled: busy, onChange: event => controller.updateSetup({ resourceMigration: { ...options.resourceMigration, [agent.id]: event.target.value === '@reset' ? { mode: 'reset' } : { mode: 'candidate', candidateId: event.target.value } } }) }, h('option', { value: '' }, t('setupMigrationRequired')), h('option', { value: '@reset' }, t('setupMigrationReset')), agent.model.candidates.map(item => h('option', { key: item.id, value: item.id }, item.id + ' · ' + item.maxTokens))))),
        h('p', { className: 'ad-help' }, t('setupLimit')),
        h(ErrorNotice, { value: state.errors.providers, t, retry: () => controller.loadProviders(true) }),
        h(ErrorNotice, { value: state.errors.recommend, t }),
        strategyIssues.length > 0 && h('p', { className: 'ad-warning' }, t('setupInputsIncomplete')),
        h(Button, { primary: true, disabled: busy || state.busy.recommend || !options.roleIds.length || strategyIssues.length > 0 || (manual && formIssues({ model: options.auto }).length > 0) || !state.setupCatalog || generatorMissing || (options.mode === 'fixed' && browserActive && options.browserSeparate && (!options.imageRoute.provider || !options.imageRoute.model)), onClick: () => controller.recommendSetup() }, t(state.busy.recommend ? 'loading' : 'setupGenerate')),
        proposal && h('div', { className: 'ad-section' },
          h('h4', null, t('setupReview')), state.setupStale && h('p', { role: 'status', className: 'ad-warning' }, t('setupStale', { context: state.setupProposalScope || t('noSession') })), h('p', { className: 'ad-help', role: 'status' }, t('setupReviewSummary', { changed: selected, unchanged: proposal.rows.filter(row => row.status === 'unchanged').length, preserved: proposal.rows.filter(row => row.status === 'preserved').length, blocked: proposal.rows.filter(row => row.status === 'blocked').length, indirect: state.setupPreviewReady ? state.setupImpacts.length : t('setupPreviewPending') })),
          h('p', { className: 'ad-help' }, t('setupInheritance')), h(DiagnosticList, { items: proposal.diagnostics, t }),
          !proposal.rows.some(row => row.applicable) && h('p', { role: 'status', className: 'ad-help' }, t(proposal.rows.every(row => row.status === 'unchanged' || row.status === 'preserved') ? 'setupNoChanges' : 'setupNoApplicable')),
          proposal.rows.map(row => h('article', { className: 'ad-candidate', key: row.id },
            h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: Boolean(state.setupSelected[row.id]), disabled: busy || state.setupStale || !row.applicable || isDirty(state.drafts[row.id]), onChange: event => { void controller.selectSetup(row.id, event.target.checked); } }), h('strong', null, locale.resolveText(row.title)), row.status && h('span', null, ' · ' + t('setupRow.' + row.status))),
            h(Stats, { rows: [[t('setupBefore'), resourceText(row.before)], [t('setupAfter'), state.setupPreviewReady ? resourceText(row.after) : t('setupPreviewPending')], ...(state.setupPreviewReady && row.after ? [[t('target'), row.before.context.targetTokens + ' → ' + row.after.context.targetTokens], [t('elastic'), row.before.context.elasticTokens + ' → ' + row.after.context.elasticTokens]] : [])] }),
            h(DiagnosticList, { items: [...row.reasons, ...row.warnings], t }), isDirty(state.drafts[row.id]) && h('p', { className: 'ad-warning' }, t('draftConflict')),
            row.proposedText && h(React.Fragment, null, h(CodeDetail, { title: t('setupYaml'), value: row.proposedText }), h(Button, { disabled: busy || state.setupStale || isDirty(state.drafts[row.id]), onClick: () => controller.stageSetup(row.id) }, t('setupEdit'))))),
          h(ErrorNotice, { value: state.errors.setupPreview, t, retry: () => controller.previewSetup() }), state.busy.setupPreview && h('p', { role: 'status', 'aria-live': 'polite' }, t('setupPreviewPending')),
          state.setupImpacts.length > 0 && h('section', { className: 'ad-section', 'aria-label': t('setupIndirect') }, h('h4', null, t('setupIndirect')), h('p', { className: 'ad-warning' }, t('setupIndirectHint')),
            state.setupImpacts.map(impact => h('article', { key: impact.id, className: 'ad-candidate' }, h('strong', null, locale.resolveText(impact.title) + ' · ' + impact.id),
              impact.scope !== 'projects' && impactResources(impact, impact.scope === 'global' ? 'setupImpactGlobal' : impact.global || impact.projects?.length ? 'setupImpactProject' : undefined),
              impact.global && impactResources(impact.global, 'setupImpactGlobal'),
              impact.projects?.map(project => h('div', { key: project.cwd }, impactResources(project, 'setupImpactOtherProject', { cwd: project.cwd }))),
              h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: state.setupAccepted[impact.id] === true, disabled: busy || !state.setupPreviewReady, onChange: event => controller.acceptSetupImpact(impact.id, event.target.checked) }), t('setupAcceptImpact'))))),
          h('p', { className: 'ad-help' }, t('setupApplyHint')),
          h(Button, { primary: true, disabled: busy || state.busy.save || state.busy.reset || !state.setupPreviewReady || state.busy.setupPreview || !selected || pendingAcceptance, onClick: () => controller.applySetup() }, t(busy ? 'saving' : 'setupApply', { count: selected }))),
        h(ErrorNotice, { value: state.errors.applySetup, t }),
        state.setupResult && h('div', { className: 'ad-section', role: 'status', 'aria-live': 'polite' }, h('h4', null, t(state.setupResult.status === 'completed' ? 'setupComplete' : state.setupResult.status === 'reconciled' ? 'setupReconciled' : 'setupStopped')), h('ul', { className: 'ad-list' }, state.setupResult.rows.map(row => h('li', { key: row.id }, h('code', null, row.id), ' · ' + t('setup.status.' + row.status), row.message && h(CodeDetail, { title: t('errorDetails'), value: row.message }))))));
    }
    const roleReview = role => role && Object.fromEntries(['source', 'extends', 'schemaVersion', 'enabled', 'model', 'reasoning', 'output', 'context'].filter(key => role[key] !== undefined).map(key => [key, role[key]]));
    function ChangeReview({ change, state, controller, t, locale }) {
      if (!change) return null;
      return h('section', { className: 'ad-section', 'aria-label': t('changeReview') },
        h('h4', null, t('changeReview') + ' · ' + change.id), h('p', { className: 'ad-help' }, t(change.reset ? 'changeDelete' : 'changeWrite')),
        change.direct && h('div', { className: 'ad-fields' }, h(CodeDetail, { title: t('setupBefore'), value: roleReview(change.direct.before) }), h(CodeDetail, { title: t('setupAfter'), value: roleReview(change.direct.after) })),
        h(CodeDetail, { title: t('setupBefore'), value: change.currentText }), h(CodeDetail, { title: t('setupYaml'), value: change.text }),
        change.impacts.map(impact => h('article', { className: 'ad-candidate', key: impact.id },
          h('strong', null, (impact.title ? locale.resolveText(impact.title) + ' · ' : '') + impact.id),
          [['setupImpactProject', impact.scope !== 'projects' && impact.scope !== 'global' && impact], ['setupImpactGlobal', impact.global || (impact.scope === 'global' && impact)], ...(impact.projects || []).map(project => ['setupImpactOtherProject', project])].filter(([, entry]) => entry).map(([label, entry]) => h('div', { key: entry.cwd || label },
            h('p', null, t(label, { cwd: entry.cwd })), h(CodeDetail, { title: t('setupBefore'), value: entry.before }), h(CodeDetail, { title: t('setupAfter'), value: entry.after }))),
          h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', checked: state.changeAccepted[impact.id] === true, disabled: state.busy.save || state.busy.reset, onChange: event => controller.acceptChangeImpact(impact.id, event.target.checked) }), t('setupAcceptImpact')))));
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
        h('div', { className: 'ad-actions', style: { marginTop: 12 } }, duplicate ? h(Button, { primary: true, disabled: conflict || Boolean(source), onClick: () => controller.useExistingDocument() }, t('useExistingTarget')) : h(Button, { primary: true, disabled: !id || state.busy.identity || state.busy.changePreview || state.busy.save || change?.impacts.some(item => !state.changeAccepted[item.id]), onClick: () => controller.save('@new') }, t(state.busy.save ? 'saving' : 'create')), h(Button, { onClick: () => exportDraft('@new') }, t('export')), h(Button, { disabled: state.busy.save, onClick: () => controller.set({ creating: false }) }, t('cancel')), h(Button, { danger: true, disabled: state.busy.save, onClick: event => openConfirmation(event, 'discard') }, t('discard'))),
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
              h(CodeDetail, { title: t('evidence'), value: state.result.evidence }), h(CodeDetail, { title: t('coverage'), value: state.result.coverage }), h(CodeDetail, { title: t('artifacts'), value: state.result.artifacts }), h(CodeDetail, { title: t('limitations'), value: state.result.limitations }), h(CodeDetail, { title: t('usage'), value: state.result.usage }), h(CodeDetail, { title: t('nativeStop'), value: state.result.nativeStop }),
              h('section', { className: 'ad-section' }, h('h4', null, t('rawText')), h('pre', null, state.result.rawText || t('resultEmpty')), h('p', { className: 'ad-help' }, t('resultCharacters', { loaded: (state.result.rawText || '').length, total: state.result.totalCharacters })), !state.resultStale && state.result.nextOffset !== undefined && h(Button, { disabled: state.busy.result, onClick: () => controller.loadResult(run.childId, true) }, t('loadMore'))))
          )))
      );
    }
    function formatDate(value, language) {
      const date = new Date(value);
      return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(language);
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
      const onImport = event => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 1024 * 1024) { controller.error('import', { code: 'importTooLarge', message: 'importTooLarge' }); return; }
        fileReader.current?.abort();
        const reader = new FileReader();
        fileReader.current = reader;
        setReading(true);
        reader.onload = () => { if (!controller.isDisposed()) { controller.importText(String(reader.result)); setReading(false); } };
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
        h('header', { className: 'ad-head' }, h('div', null, h('h2', null, t('title')), h('p', { className: 'ad-muted ad-intro' }, t('intro'))), h(Button, { disabled: state.busy.catalog || state.busy.applySetup, onClick: refresh }, t('refresh'))),
        h('div', { className: 'ad-tabs', role: 'tablist', 'aria-label': t('title') }, ['roles', 'runs', 'diagnostics'].map((tab, index) => h('button', { key: tab, className: 'ad-tab', type: 'button', role: 'tab', id: 'agentdeck-tab-' + tab, 'aria-selected': state.tab === tab, 'aria-controls': 'agentdeck-panel-' + tab, tabIndex: state.tab === tab ? 0 : -1, onClick: () => controller.set({ tab }), onKeyDown: event => { const tabs = ['roles', 'runs', 'diagnostics']; const next = event.key === 'ArrowRight' ? tabs[(index + 1) % 3] : event.key === 'ArrowLeft' ? tabs[(index + 2) % 3] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : null; if (next) { event.preventDefault(); controller.set({ tab: next }); event.currentTarget.parentElement.querySelector('#agentdeck-tab-' + next)?.focus(); } } }, t(tab)))),
        state.tab === 'roles' && h(SessionField, { id: 'agentdeck-session', label: t('session'), help: t('sessionHint'), value: state.sessionId, sessions, empty: t('noSession'), disabled: state.busy.save || state.busy.reset, onChange: value => { controller.setSession(value); void controller.loadCatalog(); } }),
        h(ErrorNotice, { value: state.errors.catalog, t }), h(ErrorNotice, { value: state.errors.import, t }), h(ErrorNotice, { value: state.errors.export, t }),
        state.notice && h('p', { className: 'ad-notice', role: 'status' }, t(state.notice)),
        dirtyCount > 0 && h('p', { className: 'ad-help', role: 'status' }, t('drafts', { count: dirtyCount })),
        state.busy.catalog && !state.catalog && h('p', { className: 'ad-empty', role: 'status' }, t('loading')),
        state.errors.catalog && !state.catalog && h(Button, { onClick: () => controller.loadCatalog() }, t('retry')),
        h('div', { role: 'tabpanel', id: 'agentdeck-panel-' + state.tab, 'aria-labelledby': 'agentdeck-tab-' + state.tab },
          state.tab === 'roles' && state.catalog && h(React.Fragment, null,
            h('div', { className: 'ad-actions', style: { marginBottom: 16 } }, h(Button, { onClick: () => { if (state.drafts['@new']) controller.set({ creating: true }); else controller.beginCreate(); }, disabled: Boolean(state.sessionId) || state.busy.save || state.busy.applySetup }, t('newRole')), h(Button, { onClick: () => fileInput.current?.click(), disabled: Boolean(state.sessionId) || reading || state.busy.save || state.busy.applySetup }, t(reading ? 'fileRead' : 'import')), h('input', { ref: fileInput, type: 'file', accept: '.yaml,.yml,.json,application/yaml,text/yaml,application/json', hidden: true, 'aria-label': t('import'), onChange: onImport })),
            h(Button, { onClick: () => controller.openSetup(), disabled: state.busy.applySetup || state.busy.save || state.busy.reset }, t('setupTitle')),
            h(SetupPanel, { state, controller, t, locale }),
            h(NewRole, { state, controller, t, locale, exportDraft }),
            h('div', { className: 'ad-layout' }, h('aside', { className: 'ad-sidebar', 'aria-label': t('roles') },
              h('label', { className: 'ad-field ad-search' }, h('span', { className: 'ad-sr' }, t('search')), h('input', { type: 'search', value: search, placeholder: t('searchHint'), onChange: event => setSearch(event.target.value) })),
              h('label', { className: 'ad-field' }, h('span', { className: 'ad-sr' }, t('roleFilter')), h('select', { value: filter, onChange: event => setFilter(event.target.value) }, h('option', { value: 'all' }, t('filterAll')), h('option', { value: 'enabled' }, t('filterEnabled')), h('option', { value: 'unavailable' }, t('filterUnavailable')))),
              h('p', { className: 'ad-help', style: { marginTop: 8 } }, t('count', { count: filtered.length + broken.length })),
              h('ul', { className: 'ad-role-list' }, filtered.map(item => h('li', { key: item.id }, h('button', { type: 'button', className: 'ad-role', 'aria-current': state.selectedId === item.id, onClick: () => controller.select(item.id) }, h('span', { className: 'ad-role-name' }, locale.resolveText(item.title)), h('span', { className: 'ad-role-meta' }, h('span', null, t(item.enabled ? 'enabled' : 'disabled')), h('span', { className: item.available ? 'ad-status' : 'ad-warning' }, t(roleStatus(item))), isDirty(state.drafts[item.id]) && h('span', null, t('dirty')))))), broken.map(item => h('li', { key: item.id }, h('button', { type: 'button', className: 'ad-role', 'aria-current': state.selectedId === item.id, onClick: () => controller.select(item.id) }, h('span', { className: 'ad-role-name' }, item.id), h('span', { className: 'ad-role-meta ad-warning' }, t('unavailable')))))),
              !filtered.length && !broken.length && h('p', { className: 'ad-empty' }, t('noRoles'))),
              h(RoleDetail, { state, controller, t, locale, exportDraft }))),
          state.tab === 'runs' && h(Runs, { state, controller, t, locale }),
          state.tab === 'diagnostics' && h('section', { 'aria-label': t('diagnostics') }, state.catalog?.runtime && h(React.Fragment, null, h('h3', null, t('runtime')), h(Stats, { rows: [[t('compatibilityVersion'), state.catalog.runtime.compatibilityVersion], [t('nativeProvider'), t(state.catalog.runtime.nativeProvider ? 'yes' : 'no')], [t('storage'), t(state.catalog.runtime.storage ? 'yes' : 'no')]] })), h('div', { className: 'ad-section' }, h('h3', null, t('diagnostics')), state.catalog?.diagnostics.length ? h(DiagnosticList, { items: state.catalog.diagnostics, t }) : h('p', { className: 'ad-empty' }, t('noDiagnostics')))))
      );
    }
    return {
      inject: ['slots', 'locale', 'connection'],
      // Pure state and serialization exports allow contract tests without a DOM or a second React runtime.
      createController, definitionText, formIssues, previewFacts, roleView, roleStatus, selectionOptions, dictionaries,
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
