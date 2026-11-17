window.__ModuleLoader__.load({
  id: 'dsh-agentdeck',
  factory(require) {
    'use strict';
    const React = require('react');
    const h = React.createElement;
    const NS = 'agentdeck';
    const dictionaries = {
      en: {
        title: 'AgentDeck', intro: 'Ready-to-use agents, with your own settings.',
        roles: 'Agents', runs: 'Tasks and results', diagnostics: 'Diagnostics', refresh: 'Refresh',
        compatibilityVersion: 'Compatible DSH version', requestTimeout: 'The read request took more than 15 seconds. Retry when the Host is ready. Your drafts are preserved.',
        loading: 'Loading…', retry: 'Retry', search: 'Search agents', searchHint: 'Name, description or capability',
        noRoles: 'No agents match this search.', noCatalog: 'Agent definitions could not be loaded.',
        chooseRole: 'Choose an agent to see its settings.', builtin: 'Factory', custom: 'Custom', override: 'Customized',
        enabled: 'Enabled', disabled: 'Disabled', available: 'Available for this Session', unavailable: 'Missing capabilities',
        modelDenied: 'Default model not authorized', selectedModelDenied: 'Selected model not authorized', capabilityUnknown: 'Capabilities unverified',
        modelDeniedHint: 'The selected model {route} is not authorized for this Session.',
        allowedRoutes: 'Allowed explicit models: {routes}',
        authorizationRecovery: 'Choose an allowed model here and save, or configure native /model-selection-settings and create a new Session. Changes to native authorization settings do not update an existing Session.',
        missing: 'Missing: {items}', revision: 'Revision', session: 'Session context', noSession: 'No Session selected',
        sessionHint: 'Select a Session to see its actual model authorization. This does not grant access.',
        newRole: 'New agent', derive: 'Derive agent', import: 'Import YAML', export: 'Export YAML',
        newTitle: 'Create an agent', newHint: 'Start from an existing agent. The Host validates the complete definition when you save.',
        id: 'Agent id', idHint: 'Use a unique lowercase id, for example project-reviewer.', base: 'Based on',
        create: 'Create agent', cancel: 'Cancel', importHint: 'Review the imported YAML and confirm its agent id before saving.',
        yaml: 'YAML override', yamlHint: 'Edit the complete override. JSON syntax is also valid YAML. Saving applies to new tasks.',
        yamlLocked: 'Save or discard this YAML draft before using the structured controls.',
        save: 'Save changes', saving: 'Saving…', saved: 'Saved. New tasks use this revision.', dirty: 'Unsaved changes',
        drafts: '{count} unsaved drafts', discard: 'Discard draft', discardConfirm: 'Discard the unsaved changes for this agent?',
        saveError: 'Could not save. Your draft is preserved.', reset: 'Reset customization',
        deleteCustom: 'Delete custom agent', resetConfirm: 'Reset this customization? New tasks will use the factory definition.',
        deleteConfirm: 'Delete this custom agent? Its running tasks keep their pinned revision.',
        confirmReset: 'Confirm reset', confirmDelete: 'Confirm delete', resetDone: 'Customization removed.',
        newStarts: 'Changes apply to new tasks. Running tasks keep their original revision.',
        model: 'Model', modelMode: 'Model selection', inherit: 'Inherit current model', fixed: 'Use a specific model',
        provider: 'Provider', chooseProvider: 'Choose a provider', chooseModel: 'Choose a model',
        effectiveModel: 'Effective model', effort: 'Reasoning effort', inheritEffort: 'Inherit when compatible',
        defaultEffort: 'Model default', fixedEffort: 'Specific effort', effortMode: 'Effort selection', chooseEffort: 'Choose an effort',
        authorization: 'Model authorization', authorized: 'Authorized for this Session', denied: 'Not authorized for this Session',
        authorizationUnknown: 'Authorization unknown', policySession: 'Session authorization', policyParent: 'Parent model only',
        policyNone: 'No selection', metadataUnavailable: 'Model metadata is unavailable.', unknown: 'Unknown', none: 'None',
        contextWindow: 'Context window', maxOutput: 'Default maximum output', modalities: 'Input modalities',
        budget: 'Context budget', target: 'Target tokens', elastic: 'Elastic tokens', safeInput: 'Safe input tokens',
        headroom: 'Reserved headroom', material: 'Material allowance', budgetHint: 'Preview uses the saved agent and actual model metadata.',
        unknownBudget: 'The model context window is unknown. Safe capacity cannot be calculated.',
        previewDraft: 'Save this draft to preview its effective budget.', capabilities: 'Capabilities',
        skills: 'Skills', scripts: 'Scripts', inputs: 'Inputs', deliverables: 'Deliverables', instructions: 'Instructions',
        scope: 'Agent requirements', noRuns: 'No AgentDeck tasks in this scope.', runsHint: 'Native status and business outcome are shown separately. Idle alone does not mean completed.',
        description: 'Task', phase: 'Start state', nativeStatus: 'Native status', businessStatus: 'Business outcome',
        starting: 'Starting', accepted: 'Accepted', uncertain: 'Uncertain', failed: 'Failed',
        results: 'View result', noChild: 'No accepted child Session', result: 'Task result', closeResult: 'Close result',
        summary: 'Summary', evidence: 'Evidence', coverage: 'Coverage', artifacts: 'Artifacts', limitations: 'Limitations',
        rawText: 'Result text', loadMore: 'Load more', resultEmpty: 'No result text is available yet.',
        usage: 'Usage', nativeStop: 'Native stop reason', child: 'Child Session', parent: 'Parent Session', created: 'Created',
        resultCharacters: '{loaded} of {total} characters loaded', noDiagnostics: 'No diagnostics reported.',
        runtime: 'Runtime', nativeProvider: 'Native delegation provider', storage: 'Plugin storage', yes: 'Available', no: 'Unavailable',
        importTooLarge: 'Import is limited to 1 MiB. Your existing drafts are preserved.', importReadError: 'Could not read this file.',
        invalidId: 'Enter an agent id before saving.', missingRevision: 'Refresh this agent before replacing an existing customization.',
        requestFailed: 'Request failed', malformedResponse: 'The Host returned an invalid operation response.',
        duplicateId: 'This id already exists. Select that agent to edit it, or choose a new id.',
        unsavedImport: 'Imported YAML is staged locally. Review and save to apply it.',
        exportFailed: 'Could not export this draft.', count: '{count} agents', filterAll: 'All agents', filterEnabled: 'Enabled only',
        filterUnavailable: 'Unavailable or unverified', roleFilter: 'Filter agents', errorDetails: 'Error details',
        fileRead: 'Reading YAML…', source: 'Source', generalFallback: 'General fallback',
        leaveDrafts: 'You have unsaved AgentDeck drafts.', sessionEffort: 'Current Session effort',
        effectiveEffort: 'Effective reasoning effort', effectiveHint: 'Configured values describe the saved agent. Validated values reflect the selected Session.',
        existingNewDraft: 'Your previous new-agent draft is preserved. Continue editing it or discard it before starting another.',
        draftConflict: 'This agent already has unsaved changes. Save or discard that draft before importing.',
        'cap.files-read': 'Read files', 'cap.source-edit': 'Edit source', 'cap.project-runner': 'Run project commands',
        'cap.web-research': 'Web research', 'cap.browser-observe': 'Observe browser', 'cap.browser-interact': 'Interact with browser',
        'cap.data-query': 'Query data', 'cap.artifact-write': 'Write artifacts'
      },
      zh: {
        title: '代理工具箱', intro: '开箱即用的代理，也可按需定制。',
        roles: '代理', runs: '任务与结果', diagnostics: '诊断', refresh: '刷新',
        compatibilityVersion: '兼容的 DSH 版本', requestTimeout: '读取请求超过 15 秒，请在宿主就绪后重试。草稿已保留。',
        loading: '正在加载…', retry: '重试', search: '搜索代理', searchHint: '名称、描述或能力',
        noRoles: '没有匹配的代理。', noCatalog: '无法加载代理定义。',
        chooseRole: '选择代理以查看设置。', builtin: '出厂预设', custom: '自定义', override: '已定制',
        enabled: '已启用', disabled: '已停用', available: '可用于此会话', unavailable: '缺少能力',
        modelDenied: '默认模型未授权', selectedModelDenied: '所选模型未授权', capabilityUnknown: '能力待验证',
        modelDeniedHint: '所选模型 {route} 未获此会话授权。',
        allowedRoutes: '允许显式选择的模型：{routes}',
        authorizationRecovery: '可在此选择已授权模型并保存，或通过原生 /model-selection-settings 配置授权后新建会话。修改原生授权设置不会更新已有会话。',
        missing: '缺少：{items}', revision: '版本', session: '会话上下文', noSession: '未选择会话',
        sessionHint: '选择会话以查看其实际模型授权。此操作不会授予权限。',
        newRole: '新建代理', derive: '派生代理', import: '导入 YAML', export: '导出 YAML',
        newTitle: '创建代理', newHint: '从现有代理开始。保存时由 Host 校验完整定义。',
        id: '代理标识', idHint: '使用唯一的小写标识，例如 project-reviewer。', base: '基于代理',
        create: '创建代理', cancel: '取消', importHint: '保存前请检查导入的 YAML，并确认代理标识。',
        yaml: 'YAML 覆盖配置', yamlHint: '编辑完整覆盖配置；JSON 也是有效 YAML。保存后对新任务生效。',
        yamlLocked: '请先保存或丢弃这份 YAML 草稿，再使用结构化控件。',
        save: '保存修改', saving: '正在保存…', saved: '已保存。新任务将使用此版本。', dirty: '有未保存修改',
        drafts: '{count} 份未保存草稿', discard: '丢弃草稿', discardConfirm: '丢弃此代理尚未保存的修改？',
        saveError: '保存失败，草稿已保留。', reset: '重置定制',
        deleteCustom: '删除自定义代理', resetConfirm: '重置此定制？新任务将使用出厂定义。',
        deleteConfirm: '删除此自定义代理？运行中的任务会保留原有版本。',
        confirmReset: '确认重置', confirmDelete: '确认删除', resetDone: '已移除定制。',
        newStarts: '修改对新任务生效；运行中的任务保留原有版本。',
        model: '模型', modelMode: '模型选择', inherit: '继承当前模型', fixed: '指定模型',
        provider: '提供商', chooseProvider: '选择提供商', chooseModel: '选择模型',
        effectiveModel: '实际生效模型', effort: '推理强度', inheritEffort: '兼容时继承',
        defaultEffort: '模型默认', fixedEffort: '指定强度', effortMode: '强度选择', chooseEffort: '选择推理强度',
        authorization: '模型授权', authorized: '此会话已授权', denied: '此会话未授权',
        authorizationUnknown: '授权未知', policySession: '会话授权', policyParent: '仅父代理模型',
        policyNone: '未选择模型', metadataUnavailable: '模型元数据不可用。', unknown: '未知', none: '无',
        contextWindow: '上下文窗口', maxOutput: '默认最大输出', modalities: '输入形式',
        budget: '上下文预算', target: '目标词元数', elastic: '弹性词元数', safeInput: '安全输入词元数',
        headroom: '预留余量', material: '材料额度', budgetHint: '预览使用已保存的代理配置与实际模型元数据。',
        unknownBudget: '模型上下文窗口未知，无法计算安全容量。',
        previewDraft: '保存草稿后可预览其实际预算。', capabilities: '能力',
        skills: '技能', scripts: '脚本', inputs: '输入', deliverables: '交付物', instructions: '指令',
        scope: '代理需求', noRuns: '此范围内暂无 AgentDeck 任务。', runsHint: '原生状态与业务结果分别展示；空闲不代表任务完成。',
        description: '任务', phase: '启动状态', nativeStatus: '原生状态', businessStatus: '业务结果',
        starting: '启动中', accepted: '已接受', uncertain: '待确认', failed: '失败',
        results: '查看结果', noChild: '尚无已接受的子会话', result: '任务结果', closeResult: '关闭结果',
        summary: '摘要', evidence: '证据', coverage: '覆盖情况', artifacts: '产物', limitations: '限制',
        rawText: '结果原文', loadMore: '加载更多', resultEmpty: '暂无结果原文。',
        usage: '用量', nativeStop: '原生停止原因', child: '子会话', parent: '父会话', created: '创建时间',
        resultCharacters: '已加载 {loaded} / {total} 个字符', noDiagnostics: '未报告诊断信息。',
        runtime: '运行环境', nativeProvider: '原生委派提供方', storage: '插件存储', yes: '可用', no: '不可用',
        importTooLarge: '导入文件上限为 1 MiB，现有草稿已保留。', importReadError: '无法读取此文件。',
        invalidId: '保存前请输入代理标识。', missingRevision: '替换现有定制前请先刷新此代理。',
        requestFailed: '请求失败', malformedResponse: 'Host 返回了无效的操作响应。',
        duplicateId: '此标识已存在。请选择该代理进行编辑，或使用新标识。',
        unsavedImport: 'YAML 已暂存于本地，检查并保存后生效。',
        exportFailed: '无法导出此草稿。', count: '{count} 个代理', filterAll: '全部代理', filterEnabled: '仅已启用',
        filterUnavailable: '不可用或待验证', roleFilter: '筛选代理', errorDetails: '错误详情',
        fileRead: '正在读取 YAML…', source: '来源', generalFallback: '通用兜底',
        leaveDrafts: '代理工具箱中有未保存的草稿。', sessionEffort: '当前会话推理强度',
        effectiveEffort: '实际生效推理强度', effectiveHint: '配置值对应已保存代理，已校验值对应当前选中的会话。',
        existingNewDraft: '已保留上一份新代理草稿。请继续编辑，或丢弃后再新建。',
        draftConflict: '此代理已有未保存修改，请先保存或丢弃现有草稿再导入。',
        'cap.files-read': '读取文件', 'cap.source-edit': '编辑源码', 'cap.project-runner': '执行项目命令',
        'cap.web-research': '网络研究', 'cap.browser-observe': '观察浏览器', 'cap.browser-interact': '操作浏览器',
        'cap.data-query': '查询数据', 'cap.artifact-write': '写入产物'
      }
    };

    dictionaries.en.capabilityPending = 'Dynamic capability not checked during this page read: {items}. The child resolves its actual tools before use.';
    dictionaries.zh.capabilityPending = '本次页面读取未检查动态能力：{items}。子代理会在使用前解析实际工具。';
    Object.assign(dictionaries.en, {
      auto: 'Choose from candidates', candidates: 'Model candidates', candidate: 'Candidate {number}', candidateId: 'Candidate id',
      candidatePurpose: 'When to use this candidate', addCandidate: 'Add candidate', removeCandidate: 'Remove candidate',
      defaultCandidate: 'Default candidate', previewCandidate: 'Preview candidate', autoHint: 'Configure up to 3 candidates. Each owns its reasoning effort and output cap. The default is used unless a task selects another candidate.',
      candidateHint: 'Choose a configured provider and model. Lists load as you use each candidate; preview reads only the selected saved candidate.',
      unavailableOption: '{value} (unavailable)', uncheckedOption: '{value} (not checked)', noModelOptions: 'This provider has no configured models. Choose another provider or configure a model in DSH.',
      outputCap: 'Output token cap', outputCapHint: 'Leave blank to use the parent or native default. A cap applies to new tasks.',
      configuredModel: 'Configured model', configuredEffort: 'Configured reasoning effort', configuredOutput: 'Configured output cap',
      effectiveOutput: 'Validated output cap', outputSource: 'Output cap source', outputValidated: 'Native parameters validated', validationPassed: 'Validated', validationPending: 'Pending',
      outputPending: 'Output parameters have not been validated for this Session.', assemblyPending: 'Actual fit is pending real child Session assembly.',
      capacity: 'Capacity estimate', capacityConfigured: 'Configured values', capacityValidated: 'Validated parameters',
      sourceCandidate: 'Candidate', sourceRole: 'Agent', sourceParent: 'Parent', sourceNative: 'Native default',
      browserSupport: 'Browser support', browserReady: 'Ready', browserUnverified: 'Unverified', browserUnsupported: 'Unsupported',
      invalidForm: 'Complete the configuration below before saving.', invalidRoute: 'Enter both provider and model ids.',
      invalidEffort: 'Choose a reasoning effort.', invalidOutput: 'Use a whole output cap from 1 to 16777216 tokens, or leave it blank.',
      invalidCandidates: 'Use 1–3 candidates with unique lowercase ids and choose an existing default.',
      invalidCandidate: 'Candidate {number}: enter a lowercase id (up to 64 characters), a purpose (1–240 characters), provider, model, a whole cap from 1 to 16777216, and an effort when using specific effort.'
    });
    Object.assign(dictionaries.zh, {
      auto: '从候选中选择', candidates: '模型候选', candidate: '候选 {number}', candidateId: '候选标识',
      candidatePurpose: '此候选适用的任务', addCandidate: '添加候选', removeCandidate: '移除候选',
      defaultCandidate: '默认候选', previewCandidate: '预览候选', autoHint: '最多配置 3 个候选，各自拥有推理强度和输出上限。任务未选择其他候选时使用默认候选。',
      candidateHint: '选择已配置的提供商与模型。使用候选时按需加载列表，预览仅读取当前选中的已保存候选。',
      unavailableOption: '{value}（不可用）', uncheckedOption: '{value}（未检查）', noModelOptions: '此提供商尚无已配置模型。请选择其他提供商，或在 DSH 中配置模型。',
      outputCap: '输出词元上限', outputCapHint: '留空时使用父会话或原生默认值；上限对新任务生效。',
      configuredModel: '配置模型', configuredEffort: '配置推理强度', configuredOutput: '配置输出上限',
      effectiveOutput: '已校验输出上限', outputSource: '输出上限来源', outputValidated: '原生参数已校验', validationPassed: '已校验', validationPending: '待校验',
      outputPending: '尚未为此会话校验输出参数。', assemblyPending: '实际容量是否适合仍需在真实子会话组装时检查。',
      capacity: '容量估计依据', capacityConfigured: '配置值', capacityValidated: '已校验参数',
      sourceCandidate: '候选', sourceRole: '代理', sourceParent: '父会话', sourceNative: '原生默认',
      browserSupport: '浏览器支持', browserReady: '就绪', browserUnverified: '未验证', browserUnsupported: '不支持',
      invalidForm: '请先补全下方配置，再保存。', invalidRoute: '请填写提供商与模型标识。',
      invalidEffort: '请选择推理强度。', invalidOutput: '输出上限须为 1 至 16777216 的整数，或留空。',
      invalidCandidates: '请配置 1 至 3 个标识唯一的小写候选，并选择已有候选作为默认值。',
      invalidCandidate: '候选 {number}：请填写小写标识（最多 64 字符）、用途（1 至 240 字符）、提供商、模型、1 至 16777216 的整数输出上限；指定推理强度时还须填写强度。'
    });
    const definitionKeys = ['schemaVersion', 'id', 'title', 'description', 'instructions', 'capabilities', 'skills', 'scripts', 'inputs', 'deliverables', 'model', 'reasoning', 'output', 'context', 'enabled', 'extends'];
    function definitionOf(agent) {
      return Object.fromEntries(definitionKeys.filter(key => agent[key] !== undefined).map(key => [key, agent[key]]));
    }
    // JSON is a YAML 1.2 subset, so generated edits need no second YAML parser.
    function definitionText(agent) { return JSON.stringify(definitionOf(agent), null, 2) + '\n'; }
    function isDirty(draft) { return Boolean(draft && draft.text !== draft.baseline); }
    const validTokens = value => Number.isSafeInteger(value) && value >= 1 && value <= 16777216;
    const validText = value => typeof value === 'string' && value.trim().length > 0 && !value.includes('\0');
    const validCandidateId = value => validText(value) && value.length <= 64 && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
    function formIssues(form) {
      if (!form) return [];
      const issues = [];
      if (form.model?.mode === 'fixed' && (!validText(form.model.provider) || !validText(form.model.model))) issues.push({ key: 'invalidRoute' });
      if (form.model?.mode !== 'auto' && form.reasoning?.mode === 'fixed' && !validText(form.reasoning.effort)) issues.push({ key: 'invalidEffort' });
      if (form.output !== undefined && !validTokens(form.output.maxTokens)) issues.push({ key: 'invalidOutput' });
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
    function guessId(text) {
      try { const value = JSON.parse(text); return typeof value.id === 'string' ? value.id : ''; } catch { /* YAML is validated by the Host. */ }
      return text.match(/^id:\s*["']?([a-z][a-z0-9-]*)["']?\s*(?:#.*)?$/m)?.[1] || '';
    }
    function createController(connection) {
      let disposed = false;
      let state = {
        catalog: null, selectedId: '', sessionId: '', tab: 'roles', drafts: {},
        models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, preview: null, previewCandidates: {}, runs: null, result: null, resultChild: '',
        creating: false, newId: '', newBase: 'general', imported: false,
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
      const publish = patch => {
        if (disposed) return;
        state = { ...state, ...patch };
        for (const listener of listeners) listener();
      };
      function error(key, value) { publish({ errors: { ...state.errors, [key]: value ? fault(value) : null } }); }
      async function request(key, endpoint, payload, accept) {
        requests.get(key)?.abort();
        const controller = new AbortController();
        requests.set(key, controller);
        publish({ busy: { ...state.busy, [key]: true }, errors: { ...state.errors, [key]: null } });
        const startedAt = Date.now();
        let timer;
        let abort;
        let timedOut = false;
        const readOnly = ['catalog', 'models', 'modelOptions', 'preview', 'runs', 'result'].includes(endpoint);
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
            }, 15000);
          })]) : call);
          if (disposed || controller.signal.aborted || requests.get(key) !== controller) return { ok: false, aborted: true };
          if (!result || typeof result.ok !== 'boolean') throw { code: 'malformedResponse', message: 'malformedResponse' };
          if (!result.ok) throw result.error;
          accept?.(result.value);
          return { ok: true, value: result.value };
        } catch (cause) {
          if (disposed || requests.get(key) !== controller || (controller.signal.aborted && !timedOut)) return { ok: false, aborted: true };
          const failure = timedOut ? { code: 'requestTimeout', message: 'requestTimeout', details: { operation: endpoint, elapsedMs: Date.now() - startedAt } } : cause;
          error(key, failure);
          return { ok: false, error: fault(failure) };
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
      const findAgent = id => state.catalog?.agents.find(agent => agent.id === id);
      const findOverride = id => state.catalog?.overrides.find(override => override.id === id);
      function makeDraft(id) {
        const agent = findAgent(id);
        const override = findOverride(id);
        const text = override?.text ?? (agent ? definitionText(agent) : '');
        return { text, baseline: text, expectedRevision: override?.revision, form: agent ? definitionOf(agent) : null, kind: 'raw' };
      }
      function ensureDraft(id) {
        if (!state.drafts[id]) publish({ drafts: { ...state.drafts, [id]: makeDraft(id) } });
      }
      async function loadCatalog() {
        return request('catalog', 'catalog', sessionPayload(), catalog => {
          const drafts = { ...state.drafts };
          const overrideById = new Map(catalog.overrides.map(item => [item.id, item]));
          for (const agent of catalog.agents) {
            if (!isDirty(drafts[agent.id])) {
              const override = overrideById.get(agent.id);
              const text = override?.text ?? definitionText(agent);
              drafts[agent.id] = { text, baseline: text, expectedRevision: override?.revision, form: definitionOf(agent), kind: 'raw' };
            }
          }
          for (const override of catalog.overrides) {
            if (!drafts[override.id]) drafts[override.id] = { text: override.text, baseline: override.text, expectedRevision: override.revision, form: null, kind: 'raw' };
          }
          const ids = new Set([...catalog.agents.map(agent => agent.id), ...catalog.overrides.map(item => item.id), ...Object.keys(drafts).filter(id => id !== '@new' && isDirty(drafts[id]))]);
          const selectedId = ids.has(state.selectedId) ? state.selectedId : (catalog.agents[0]?.id || catalog.overrides[0]?.id || '');
          publish({ catalog, drafts, selectedId });
        });
      }
      function select(id) { ensureDraft(id); publish({ selectedId: id, creating: false, preview: null, notice: '' }); }
      function edit(id, text) {
        ensureDraft(id);
        publish({ drafts: { ...state.drafts, [id]: { ...state.drafts[id], text, kind: 'raw' } }, notice: '' });
      }
      function updateForm(id, patch) {
        ensureDraft(id);
        const draft = state.drafts[id];
        if (!draft.form || (isDirty(draft) && draft.kind === 'raw')) return;
        const form = { ...draft.form, ...patch };
        if (patch.model?.mode === 'auto' || Object.hasOwn(patch, 'output')) form.schemaVersion = 2;
        if (form.model?.mode === 'auto') { form.reasoning = { mode: 'model-default' }; delete form.output; }
        if (form.output === undefined) delete form.output;
        // A saved override must explicitly clear an inherited cap; omission would inherit it again.
        const serialized = form.schemaVersion === 2 && form.model.mode !== 'auto' && form.output === undefined ? { ...form, output: null } : form;
        publish({ drafts: { ...state.drafts, [id]: { ...draft, form, text: definitionText(serialized), kind: 'form' } }, notice: '' });
      }
      function setModelMode(id, mode) {
        ensureDraft(id);
        const form = state.drafts[id]?.form;
        if (!form) return;
        const route = form.model.mode === 'fixed' ? form.model : form.model.mode === 'auto' ? form.model.candidates.find(item => item.id === form.model.defaultCandidate) : state.preview?.effectiveSelection || state.preview?.configuredSelection;
        const model = mode === 'auto' ? { mode, defaultCandidate: 'default', candidates: [{ id: 'default', purpose: '', provider: route?.provider || '', model: route?.model || '', reasoning: { mode: 'model-default' }, maxTokens: form.output?.maxTokens ?? state.preview?.model?.defaultMaxTokens ?? '' }] } : mode === 'fixed' ? { mode, provider: route?.provider || '', model: route?.model || '' } : { mode: 'inherit' };
        updateForm(id, { model, reasoning: { mode: mode === 'auto' ? 'model-default' : 'inherit-compatible' } });
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
        if (isDirty(state.drafts['@new'])) { publish({ creating: true, notice: 'existingNewDraft' }); return; }
        const text = JSON.stringify({ schemaVersion: findAgent(base)?.schemaVersion ?? 1, id: '', extends: base }, null, 2) + '\n';
        publish({ creating: true, newId: '', newBase: base, imported: false, notice: '', drafts: { ...state.drafts, '@new': { text, baseline: text, kind: 'raw', form: null } } });
      }
      function setNewId(id) {
        const draft = state.drafts['@new'];
        let text = draft.text;
        if (!state.imported) {
          try { text = JSON.stringify({ ...JSON.parse(text), id }, null, 2) + '\n'; } catch { /* Preserve hand-edited YAML. */ }
        }
        publish({ newId: id, drafts: { ...state.drafts, '@new': { ...draft, text } } });
      }
      function setNewBase(base) {
        if (state.imported) return;
        const draft = state.drafts['@new'];
        let text = draft.text;
        try { text = JSON.stringify({ ...JSON.parse(text), schemaVersion: findAgent(base)?.schemaVersion ?? 1, extends: base }, null, 2) + '\n'; } catch { /* Preserve hand-edited YAML. */ }
        publish({ newBase: base, drafts: { ...state.drafts, '@new': { ...draft, text } } });
      }
      function importText(text) {
        if (new TextEncoder().encode(text).length > 1024 * 1024) { error('import', { code: 'importTooLarge', message: 'importTooLarge' }); return false; }
        const id = guessId(text);
        const existing = id && (findAgent(id) || findOverride(id));
        const key = existing ? id : '@new';
        if (isDirty(state.drafts[key])) { error('import', { code: 'draftConflict', message: 'draftConflict' }); return false; }
        const baseline = existing ? makeDraft(id) : { baseline: '', form: null };
        publish({ creating: !existing, imported: !existing, newId: id, ...(existing ? { selectedId: id } : {}), notice: 'unsavedImport', drafts: { ...state.drafts, [key]: { ...baseline, text, kind: 'raw' } }, errors: { ...state.errors, import: null } });
        return true;
      }
      async function save(id) {
        const key = id === '@new' ? '@new' : id;
        const targetId = key === '@new' ? state.newId.trim() : id;
        if (!targetId) { error('save', { code: 'invalidId', message: 'invalidId' }); return { ok: false }; }
        if (key === '@new' && (findAgent(targetId) || findOverride(targetId))) {
          error('save', { code: 'duplicateId', message: 'duplicateId' }); return { ok: false };
        }
        const draft = state.drafts[key];
        if (!draft) return { ok: false };
        const issues = draft.kind === 'form' ? formIssues(draft.form) : [];
        if (issues.length) { error('save', { code: 'invalidForm', message: 'invalidForm', details: { issues } }); return { ok: false }; }
        if (findOverride(targetId) && !draft.expectedRevision) {
          error('save', { code: 'missingRevision', message: 'missingRevision' }); return { ok: false };
        }
        const text = draft.text;
        const answer = await request('save', 'save', { ...sessionPayload(), id: targetId, text, ...(draft.expectedRevision ? { expectedRevision: draft.expectedRevision } : {}) }, value => {
          const current = state.drafts[key];
          const saved = { ...current, baseline: value.text, expectedRevision: value.revision, text: current.text === text ? value.text : current.text };
          const drafts = { ...state.drafts, [targetId]: saved };
          if (key === '@new') delete drafts['@new'];
          publish({ drafts, ...(key === '@new' ? { creating: false, selectedId: targetId } : {}), notice: 'saved' });
        });
        if (answer.ok && !disposed) await loadCatalog();
        return answer;
      }
      async function reset(id) {
        const draft = state.drafts[id];
        if (!draft?.expectedRevision) { error('reset', { code: 'missingRevision', message: 'missingRevision' }); return { ok: false }; }
        const answer = await request('reset', 'reset', { ...sessionPayload(), id, expectedRevision: draft.expectedRevision }, () => {
          const drafts = { ...state.drafts };
          delete drafts[id];
          publish({ drafts, notice: 'resetDone', preview: null });
        });
        if (answer.ok && !disposed) await loadCatalog();
        return answer;
      }
      function discard(id) {
        publish({ drafts: { ...state.drafts, [id]: makeDraft(id) }, errors: { ...state.errors, save: null, reset: null }, notice: '' });
      }
      function acceptProviders(value) {
        publish({ providers: value.providers, providersLoaded: true });
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
        publish({ preview: null });
        return request('preview', 'preview', { id, ...sessionPayload(), ...(revision ? { revision } : {}), ...(candidateId ? { candidateId } : {}) }, preview => publish({ preview }));
      }
      function syncReads(force = false) {
        if (refreshing || !state.catalog || disposed) return Promise.resolve([]);
        if (state.tab !== 'roles') {
          cancelModelReads();
          requests.get('preview')?.abort(); requests.delete('preview');
          modelReadKey = previewReadKey = undefined;
          publish({ busy: { ...state.busy, preview: false } });
          return state.tab === 'runs' && (force || state.runs === null && !state.busy.runs && !state.errors.runs) ? Promise.all([api.loadRuns()]) : Promise.resolve([]);
        }
        const agent = findAgent(state.selectedId);
        if (!agent) return Promise.resolve([]);
        const reads = [];
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
        return Promise.all(reads);
      }
      async function refresh() {
        refreshing = true;
        cancelModelReads();
        requests.get('preview')?.abort(); requests.delete('preview');
        publish({ preview: null, busy: { ...state.busy, preview: false }, models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false });
        try {
          const answer = await loadCatalog();
          if (answer.ok && !disposed) { refreshing = false; await syncReads(true); }
          return answer;
        } finally { refreshing = false; }
      }
      function setSession(sessionId) {
        cancelModelReads();
        modelReadKey = previewReadKey = undefined;
        for (const key of ['catalog', 'preview', 'runs', 'result']) { requests.get(key)?.abort(); requests.delete(key); }
        publish({ sessionId, catalog: null, models: null, modelOptions: {}, modelMetadata: {}, providers: [], providersLoaded: false, preview: null, runs: null, result: null, resultChild: '', errors: {}, busy: {} });
      }
      const api = {
        getSnapshot: () => state,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        activate: () => { disposed = false; },
        dispose: () => { disposed = true; modelGeneration++; for (const controller of requests.values()) controller.abort(); requests.clear(); listeners.clear(); },
        isDisposed: () => disposed,
        set: publish, error, loadCatalog, select, edit, updateForm, setModelMode, updateCandidate, addCandidate, removeCandidate, selectPreviewCandidate, beginCreate, setNewId, setNewBase, importText, save, reset, discard, setSession,
        loadModels, loadProviders, loadModelOptions, modelOptionsState, modelMetadataState, loadCandidateOptions, loadCandidateMetadata, setCandidateProvider, setCandidateModel, loadPreview, syncReads, refresh,
        loadRuns: () => request('runs', 'runs', sessionPayload(), value => publish({ runs: value.runs })),
        closeResult: () => { requests.get('result')?.abort(); requests.delete('result'); publish({ result: null, resultChild: '', busy: { ...state.busy, result: false }, errors: { ...state.errors, result: null } }); },
        loadResult(childId, more = false) {
          const previous = more && state.resultChild === childId ? state.result : null;
          publish({ resultChild: childId, result: previous });
          return request('result', 'result', { childId, ...sessionPayload(), offset: previous?.nextOffset ?? 0, limit: 12000 }, value => {
            publish({ result: previous ? { ...value, rawText: previous.rawText + value.rawText } : value });
          });
        }
      };
      return api;
    }

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
    function Button({ children, primary, danger, ...props }) {
      return h('button', { type: 'button', ...props, className: 'ad-btn' + (primary ? ' ad-primary' : '') + (danger ? ' ad-danger' : '') }, children);
    }
    function Stats({ rows }) {
      return h('dl', { className: 'ad-stats' }, rows.map(([label, value]) => h('div', { key: label }, h('dt', null, label), h('dd', null, value))));
    }
    function ErrorNotice({ value, t, save, retry }) {
      if (!value) return null;
      const message = dictionaries.en[value.message] ? t(value.message) : value.message;
      return h('div', { className: 'ad-alert ad-error', role: 'alert' },
        save && h('p', null, t('saveError')), h('p', null, message),
        value.code && !dictionaries.en[value.code] && h('code', null, value.code),
        value.details && h('details', null, h('summary', null, t('errorDetails')), h('pre', null, JSON.stringify(value.details, null, 2))),
        retry && h(Button, { onClick: retry }, t('retry')));
    }
    function DiagnosticList({ items, t }) {
      if (!items?.length) return null;
      return h('ul', { className: 'ad-list ad-warning' }, items.map((item, index) => h('li', { key: index }, typeof item === 'string' ? item : [item.id, item.source, item.message].filter(Boolean).join(' · '))));
    }
    function CodeDetail({ title, value }) {
      if (value === undefined || value === null || (Array.isArray(value) && !value.length)) return null;
      return h('details', { className: 'ad-details' }, h('summary', null, title), h('pre', null, typeof value === 'string' ? value : JSON.stringify(value, null, 2)));
    }
    function ModelControls({ state, controller, agent, draft, t }) {
      const form = draft?.form;
      const locked = !form || (isDirty(draft) && draft.kind === 'raw');
      const disabled = locked || state.busy.save;
      const model = form?.model || agent.model;
      const reasoning = form?.reasoning || agent.reasoning;
      const models = state.models;
      const fixed = model.mode === 'fixed';
      const auto = model.mode === 'auto';
      const preview = state.preview?.agent.id === agent.id && state.preview?.agent.revision === agent.revision ? state.preview : undefined;
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
        h('div', { className: 'ad-fields' },
          h(Field, { label: t('modelMode') }, h('select', { ...field('model-mode'), value: model.mode, disabled, onChange: event => controller.setModelMode(agent.id, event.target.value) }, h('option', { value: 'inherit' }, t('inherit')), h('option', { value: 'fixed' }, t('fixed')), h('option', { value: 'auto' }, t('auto')))),
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
          [t('modalities'), exact?.inputModalities?.join(', ') || t('unknown')]
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
    function RoleDetail({ state, controller, t, locale, exportDraft }) {
      const [confirmation, setConfirmation] = React.useState('');
      React.useEffect(() => setConfirmation(''), [state.selectedId]);
      const agent = roleView(state.catalog?.agents.find(item => item.id === state.selectedId), state.preview);
      const draft = state.drafts[state.selectedId];
      const override = state.catalog?.overrides.find(item => item.id === state.selectedId);
      if (!draft) return h('p', { className: 'ad-empty' }, t('chooseRole'));
      const dirty = isDirty(draft);
      const form = draft.form;
      const locked = !form || (dirty && draft.kind === 'raw');
      const localized = value => locale.resolveText(value);
      const preview = state.preview?.agent.id === agent?.id && state.preview?.agent.revision === agent?.revision ? state.preview : null;
      const facts = previewFacts(preview, state.sessionId);
      const invalidForm = draft.kind === 'form' && formIssues(form).length > 0;
      const resetCustom = agent && !agent.builtin;
      return h('article', { className: 'ad-detail' },
        h('div', { className: 'ad-detail-head' }, h('div', null,
          h('h3', null, agent ? localized(agent.title) : state.selectedId),
          h('div', { className: 'ad-role-meta' }, h('code', null, state.selectedId), agent && h('span', null, t(agent.builtin ? 'builtin' : 'custom')), override && h('span', null, t('override')))),
          h('div', { className: 'ad-actions' }, agent && h(Button, { onClick: () => controller.beginCreate(agent.id) }, t('derive')), h(Button, { onClick: () => exportDraft(state.selectedId) }, t('export')))),
        agent && h('p', { className: 'ad-detail-desc' }, localized(agent.description)),
        agent && h('div', { className: 'ad-tags' },
          h('span', { className: agent.available ? 'ad-status' : 'ad-warning' }, t(roleStatus(agent, true))),
          h('span', { className: 'ad-tag' }, t('revision') + ' ' + agent.revision.slice(0, 12)),
          agent.id === 'general' && h('span', { className: 'ad-tag' }, t('generalFallback'))),
        agent?.missingCapabilities.length > 0 && h('p', { className: 'ad-warning' }, t('missing', { items: agent.missingCapabilities.map(id => t('cap.' + id)).join(', ') })),
        agent?.unverifiedCapabilities?.length > 0 && h('p', { className: 'ad-help' }, t('capabilityPending', { items: agent.unverifiedCapabilities.map(id => t('cap.' + id)).join(', ') })),
        agent?.browserSupport && h('p', { className: 'ad-help' }, t('browserSupport') + ': ' + t({ ready: 'browserReady', unverified: 'browserUnverified', unsupported: 'browserUnsupported' }[agent.browserSupport.state] || 'unknown') + (agent.browserSupport.reason ? ' · ' + agent.browserSupport.reason : '')),
        agent && h('div', { className: 'ad-section' },
          h('label', { className: 'ad-check' }, h('input', { type: 'checkbox', role: 'switch', 'aria-checked': form?.enabled ?? agent.enabled, checked: form?.enabled ?? agent.enabled, disabled: locked || state.busy.save, onChange: event => controller.updateForm(agent.id, { enabled: event.target.checked }) }), h('span', null, t((form?.enabled ?? agent.enabled) ? 'enabled' : 'disabled'))),
          h('p', { className: 'ad-help' }, t('newStarts'))),
        agent && h(ModelControls, { state, controller, agent, draft, t }),
        agent && h('section', { className: 'ad-section', 'aria-label': t('budget') },
          h('h4', null, t('budget')), h('p', { className: 'ad-help' }, t('budgetHint')),
          h('div', { className: 'ad-fields' },
            h(Field, { label: t('target') }, h('input', { type: 'number', min: 0, step: 1, value: form?.context.targetTokens ?? agent.context.targetTokens, disabled: locked || state.busy.save, onChange: event => controller.updateForm(agent.id, { context: { ...form.context, targetTokens: event.target.value === '' ? '' : Number(event.target.value) } }) })),
            h(Field, { label: t('elastic') }, h('input', { type: 'number', min: 0, step: 1, value: form?.context.elasticTokens ?? agent.context.elasticTokens, disabled: locked || state.busy.save, onChange: event => controller.updateForm(agent.id, { context: { ...form.context, elasticTokens: event.target.value === '' ? '' : Number(event.target.value) } }) }))),
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
          h('label', { className: 'ad-field' }, h('span', null, t('yaml')), h('span', { className: 'ad-help' }, t('yamlHint')),
            h('textarea', { className: 'ad-yaml', value: draft.text, spellCheck: false, autoCapitalize: 'off', autoCorrect: 'off', onChange: event => controller.edit(state.selectedId, event.target.value) })),
          h(ErrorNotice, { value: state.errors.save, t, save: true }), h(ErrorNotice, { value: state.errors.reset, t }),
          h('div', { className: 'ad-savebar' }, h('span', { className: 'ad-help', role: 'status' }, dirty ? t('dirty') : ''), h('div', { className: 'ad-actions' },
            dirty && h(Button, { disabled: state.busy.save || state.busy.reset, onClick: () => setConfirmation('discard') }, t('discard')),
            h(Button, { primary: true, disabled: !dirty || invalidForm || state.busy.save || state.busy.reset, onClick: () => controller.save(state.selectedId) }, t(state.busy.save ? 'saving' : 'save')))),
          override && h('div', { className: 'ad-actions', style: { marginTop: 12 } }, h(Button, { danger: true, disabled: state.busy.save || state.busy.reset, onClick: () => setConfirmation('reset') }, t(resetCustom ? 'deleteCustom' : 'reset'))),
          confirmation && h('div', { className: 'ad-inline-confirm' }, h('p', null, t(confirmation === 'discard' ? 'discardConfirm' : resetCustom ? 'deleteConfirm' : 'resetConfirm')), h('div', { className: 'ad-actions' }, h(Button, { danger: true, disabled: state.busy.save || state.busy.reset, onClick: () => { if (confirmation === 'discard') { controller.discard(state.selectedId); setConfirmation(''); } else controller.reset(state.selectedId).then(answer => { if (answer.ok && !controller.isDisposed()) setConfirmation(''); }); } }, t(confirmation === 'discard' ? 'discard' : resetCustom ? 'confirmDelete' : 'confirmReset')), h(Button, { onClick: () => setConfirmation('') }, t('cancel'))))),
        agent && h('section', { className: 'ad-section', 'aria-label': t('scope') }, h('h4', null, t('scope')),
          h(Stats, { rows: [[t('capabilities'), agent.capabilities.map(id => t('cap.' + id)).join(', ') || t('none')], [t('skills'), agent.skills.join(', ') || t('none')], [t('scripts'), agent.scripts.join(', ') || t('none')]] }),
          h(CodeDetail, { title: t('inputs'), value: agent.inputs }), h(CodeDetail, { title: t('deliverables'), value: agent.deliverables }), h(CodeDetail, { title: t('instructions'), value: agent.instructions }))
      );
    }
    function NewRole({ state, controller, t, exportDraft }) {
      const [discarding, setDiscarding] = React.useState(false);
      const draft = state.drafts['@new'];
      if (!state.creating || !draft) return null;
      return h('section', { className: 'ad-new', 'aria-label': t('newTitle') },
        h('h3', null, t('newTitle')), h('p', { className: 'ad-help' }, t(state.imported ? 'importHint' : 'newHint')),
        h('div', { className: 'ad-fields' },
          h(Field, { label: t('id'), help: t('idHint') }, h('input', { value: state.newId, autoCapitalize: 'off', spellCheck: false, onChange: event => controller.setNewId(event.target.value) })),
          !state.imported && h(Field, { label: t('base') }, h('select', { value: state.newBase, onChange: event => controller.setNewBase(event.target.value) }, state.catalog?.agents.map(agent => h('option', { key: agent.id, value: agent.id }, agent.id))))),
        h('label', { className: 'ad-field', style: { marginTop: 12 } }, h('span', null, t('yaml')), h('textarea', { className: 'ad-yaml', value: draft.text, spellCheck: false, onChange: event => { controller.set({ imported: true }); controller.edit('@new', event.target.value); } })),
        h(ErrorNotice, { value: state.errors.save, t, save: true }),
        h('div', { className: 'ad-actions', style: { marginTop: 12 } }, h(Button, { primary: true, disabled: !state.newId.trim() || state.busy.save, onClick: () => controller.save('@new') }, t(state.busy.save ? 'saving' : 'create')), h(Button, { onClick: () => exportDraft('@new') }, t('export')), h(Button, { disabled: state.busy.save, onClick: () => controller.set({ creating: false }) }, t('cancel')), h(Button, { danger: true, disabled: state.busy.save, onClick: () => setDiscarding(true) }, t('discard'))),
        discarding && h('div', { className: 'ad-inline-confirm' }, h('p', null, t('discardConfirm')), h('div', { className: 'ad-actions' }, h(Button, { danger: true, onClick: () => { const drafts = { ...state.drafts }; delete drafts['@new']; controller.set({ drafts, creating: false }); setDiscarding(false); } }, t('discard')), h(Button, { onClick: () => setDiscarding(false) }, t('cancel'))))
      );
    }
    function Runs({ state, controller, t, locale }) {
      return h('section', { 'aria-label': t('runs') }, h('p', { className: 'ad-help' }, t('runsHint')),
        h(ErrorNotice, { value: state.errors.runs, t }),
        state.busy.runs && h('p', { className: 'ad-empty', role: 'status' }, t('loading')),
        state.runs?.length === 0 && h('p', { className: 'ad-empty' }, t('noRuns')),
        state.runs?.map(run => h('article', { className: 'ad-run', key: run.id },
          h('p', { className: 'ad-run-title' }, run.description),
          h('div', { className: 'ad-run-meta' }, h('code', null, run.roleId), h('span', null, t('phase') + ': ' + t(run.phase)), h('span', null, t('nativeStatus') + ': ' + (run.nativeStatus || t('unknown'))), h('span', null, t('businessStatus') + ': ' + (run.businessStatus || t('unknown')))),
          h('div', { className: 'ad-run-meta' }, h('span', null, t('revision') + ': ' + run.revision.slice(0, 12)), h('time', { dateTime: run.createdAt }, t('created') + ': ' + formatDate(run.createdAt, locale.getSnapshot().active))),
          run.model && h('p', { className: 'ad-help' }, run.model.provider + ' / ' + run.model.model + (run.model.reasoningEffort ? ' · ' + run.model.reasoningEffort : '')),
          run.error && h('p', { className: 'ad-error' }, run.error),
          h('div', { className: 'ad-run-actions' }, run.childId ? h(Button, { onClick: () => controller.loadResult(run.childId), disabled: state.busy.result && state.resultChild === run.childId }, t('results')) : h('span', { className: 'ad-help' }, t('noChild'))),
          state.resultChild === run.childId && h('section', { className: 'ad-result', 'aria-label': t('result'), 'aria-busy': Boolean(state.busy.result) },
            h('div', { className: 'ad-detail-head' }, h('h3', null, t('result')), h(Button, { onClick: () => controller.closeResult() }, t('closeResult'))),
            h(ErrorNotice, { value: state.errors.result, t }),
            state.busy.result && h('p', { role: 'status' }, t('loading')),
            state.result && h(React.Fragment, null,
              h(Stats, { rows: [[t('nativeStatus'), state.result.status], [t('child'), state.result.childId], [t('parent'), run.parentId]] }),
              h('section', { className: 'ad-section' }, h('h4', null, t('summary')), h('pre', null, typeof state.result.summary === 'string' ? state.result.summary : JSON.stringify(state.result.summary, null, 2))),
              h(CodeDetail, { title: t('evidence'), value: state.result.evidence }), h(CodeDetail, { title: t('coverage'), value: state.result.coverage }), h(CodeDetail, { title: t('artifacts'), value: state.result.artifacts }), h(CodeDetail, { title: t('limitations'), value: state.result.limitations }), h(CodeDetail, { title: t('usage'), value: state.result.usage }), h(CodeDetail, { title: t('nativeStop'), value: state.result.nativeStop }),
              h('section', { className: 'ad-section' }, h('h4', null, t('rawText')), h('pre', null, state.result.rawText || t('resultEmpty')), h('p', { className: 'ad-help' }, t('resultCharacters', { loaded: state.result.rawText.length, total: state.result.totalCharacters })), state.result.nextOffset !== undefined && h(Button, { disabled: state.busy.result, onClick: () => controller.loadResult(run.childId, true) }, t('loadMore'))))
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
      const exportDraft = id => {
        try {
          const item = state.drafts[id];
          if (!item) return;
          const url = URL.createObjectURL(new Blob([item.text], { type: 'application/yaml;charset=utf-8' }));
          setExportUrl(url);
          const link = document.createElement('a');
          link.href = url;
          link.download = (id === '@new' ? state.newId || 'agentdeck' : id).replace(/[^a-zA-Z0-9_-]/g, '_') + '.yaml';
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
      const roles = (state.catalog?.agents || []).map(item => roleView(item, state.preview, true));
      const lowerSearch = search.toLocaleLowerCase();
      const filtered = roles.filter(item => (filter === 'all' || filter === 'enabled' && item.enabled || filter === 'unavailable' && !item.available) && [item.id, locale.resolveText(item.title), locale.resolveText(item.description), ...item.capabilities, ...item.capabilities.map(id => t('cap.' + id))].join(' ').toLocaleLowerCase().includes(lowerSearch));
      const broken = state.catalog?.overrides.filter(item => !roles.some(agent => agent.id === item.id) && item.id.toLocaleLowerCase().includes(lowerSearch)) || [];
      const sessions = state.catalog?.sessions || [];
      return h('div', { className: 'ad-root' }, h('style', null, css),
        h('header', { className: 'ad-head' }, h('div', null, h('h2', null, t('title')), h('p', { className: 'ad-muted ad-intro' }, t('intro'))), h(Button, { disabled: state.busy.catalog, onClick: refresh }, t('refresh'))),
        h('div', { className: 'ad-tabs', role: 'tablist', 'aria-label': t('title') }, ['roles', 'runs', 'diagnostics'].map((tab, index) => h('button', { key: tab, className: 'ad-tab', type: 'button', role: 'tab', id: 'agentdeck-tab-' + tab, 'aria-selected': state.tab === tab, 'aria-controls': 'agentdeck-panel-' + tab, tabIndex: state.tab === tab ? 0 : -1, onClick: () => controller.set({ tab }), onKeyDown: event => { const tabs = ['roles', 'runs', 'diagnostics']; const next = event.key === 'ArrowRight' ? tabs[(index + 1) % 3] : event.key === 'ArrowLeft' ? tabs[(index + 2) % 3] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[2] : null; if (next) { event.preventDefault(); controller.set({ tab: next }); event.currentTarget.parentElement.querySelector('#agentdeck-tab-' + next)?.focus(); } } }, t(tab)))),
        h('div', { className: 'ad-session' }, h('label', { htmlFor: 'agentdeck-session' }, t('session')), h('div', { className: 'ad-stack' }, h('select', { id: 'agentdeck-session', value: state.sessionId, disabled: state.busy.save || state.busy.reset, onChange: event => { controller.setSession(event.target.value); controller.loadCatalog(); } }, h('option', { value: '' }, t('noSession')), state.sessionId && !sessions.some(item => item.id === state.sessionId) && h('option', { value: state.sessionId }, state.sessionId), sessions.map(item => h('option', { key: item.id, value: item.id }, item.title || item.id))), h('p', { className: 'ad-help' }, t('sessionHint')))),
        h(ErrorNotice, { value: state.errors.catalog, t }), h(ErrorNotice, { value: state.errors.import, t }), h(ErrorNotice, { value: state.errors.export, t }),
        state.notice && h('p', { className: 'ad-notice', role: 'status' }, t(state.notice)),
        dirtyCount > 0 && h('p', { className: 'ad-help', role: 'status' }, t('drafts', { count: dirtyCount })),
        state.busy.catalog && !state.catalog && h('p', { className: 'ad-empty', role: 'status' }, t('loading')),
        state.errors.catalog && !state.catalog && h(Button, { onClick: () => controller.loadCatalog() }, t('retry')),
        h('div', { role: 'tabpanel', id: 'agentdeck-panel-' + state.tab, 'aria-labelledby': 'agentdeck-tab-' + state.tab },
          state.tab === 'roles' && state.catalog && h(React.Fragment, null,
            h('div', { className: 'ad-actions', style: { marginBottom: 16 } }, h(Button, { onClick: () => { if (state.drafts['@new']) controller.set({ creating: true }); else controller.beginCreate(); }, disabled: state.busy.save }, t('newRole')), h(Button, { onClick: () => fileInput.current?.click(), disabled: reading || state.busy.save }, t(reading ? 'fileRead' : 'import')), h('input', { ref: fileInput, type: 'file', accept: '.yaml,.yml,.json,application/yaml,text/yaml,application/json', hidden: true, 'aria-label': t('import'), onChange: onImport })),
            h(NewRole, { state, controller, t, exportDraft }),
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
