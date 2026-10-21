// Antigravity Local Agent Engine - ReAct Agent Orchestrator

const { createProvider, HybridRouter, FallbackAgentProvider } = require('./providers');
const { SYSTEM_PROMPT } = require('./prompts');
const PrivacyEnforcer = require('../security/privacy');

class AgentOrchestrator {
  constructor(toolRegistry, memoryManager, config = {}) {
    this.toolRegistry = toolRegistry;
    this.memoryManager = memoryManager;
    this.config = config;
    this.privacyEnforcer = new PrivacyEnforcer(this.config);
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.privacyEnforcer.updateConfig(this.config);
  }

  // Centralized fallback authorization on provider failure
  canFallbackOnProviderError({ requestedProvider = 'hybrid', activePolicy = 'balanced', error = {} }) {
    // If aborted, halted, or cancelled: never fall back, halt immediately
    const errMsg = (error?.message || '').toLowerCase();
    if (error?.name === 'AbortError' || errMsg.includes('aborted') || errMsg.includes('halted') || errMsg.includes('cancel')) {
      return { allowed: false, reason: 'Task execution halted or cancelled.' };
    }

    // A privacy block or security violation cannot be bypassed via fallback to another provider
    if (errMsg.includes('privacy') || errMsg.includes('protected') || errMsg.includes('security block')) {
      return {
        allowed: false,
        reason: `Privacy restriction: ${error.message}. Provider fallback prohibited after privacy block.`
      };
    }

    const isManual = requestedProvider && requestedProvider.toLowerCase() !== 'hybrid';
    const allowFallback = Boolean(this.config.allowFallbackOnMissingCredentials);

    // In Manual Mode, fallback to Autonomous Engine is strictly forbidden unless explicitly authorized
    if (isManual && !allowFallback) {
      return {
        allowed: false,
        reason: `Provider error (${error.message}). Automatic fallback to Autonomous Engine is disabled in Manual mode.`
      };
    }

    return {
      allowed: true,
      targetProvider: 'autonomous',
      reason: `Provider error (${error.message}). Switched to Built-in Autonomous Engine.`
    };
  }

  // Execute full agent task pipeline
  async runTask({ task, conversationId = null, providerName = 'hybrid', context = {}, clientWs = null, abortSignal = null }) {
    console.log(`\n[Agent Orchestrator] Starting task: "${task}" (Requested: ${providerName}, Conv: ${conversationId || 'none'})`);

    const notify = (msg) => {
      if (clientWs && clientWs.readyState === 1) { // 1 = OPEN
        try {
          clientWs.send(JSON.stringify({
            conversationId,
            ...msg
          }));
        } catch (e) {
          console.warn('[Orchestrator] Notification failed:', e.message);
        }
      }
    };

    if (abortSignal?.aborted) {
      notify({
        type: 'TASK_COMPLETE',
        success: false,
        aborted: true,
        summary: '🛑 Task halted: Emergency Stop is active.'
      });
      return { success: false, aborted: true, summary: 'Task halted by Emergency Stop' };
    }

    const router = new HybridRouter(this.config);
    const routed = router.routeTask({
      task,
      context,
      providerName,
      config: this.config,
      toolRegistry: this.toolRegistry
    });
    const { provider, activeProviderName, isFallback, fallbackReason, policy, model, reason, blocked, error } = routed;

    if (blocked) {
      notify({
        type: 'TASK_COMPLETE',
        success: false,
        blocked: true,
        summary: `❌ ${error || 'Provider not configured'}`
      });
      return { success: false, blocked: true, summary: error || 'Provider not configured' };
    }

    // Report active provider, policy, and any fallback switch
    notify({
      type: 'PROVIDER_ACTIVE',
      provider: activeProviderName,
      requestedProvider: providerName,
      policy: policy || 'balanced',
      model: model || null,
      isFallback: Boolean(isFallback),
      reason: reason || fallbackReason || null
    });

    if (reason || (isFallback && fallbackReason)) {
      notify({
        type: 'AGENT_MESSAGE',
        message: `ℹ️ ${reason || fallbackReason}`
      });
    }

    // If using autonomous engine
    if (provider instanceof FallbackAgentProvider) {
      return this.runAutonomousFallback(task, context, provider, notify, abortSignal);
    }

    // Otherwise run iterative ReAct loop with selected LLM
    return this.runLlmReActLoop(
      task,
      context,
      provider,
      notify,
      abortSignal,
      policy,
      providerName || activeProviderName,
      conversationId
    );
  }

  // --- Autonomous Engine Execution ---
  async runAutonomousFallback(task, context, provider, notify, abortSignal) {
    if (abortSignal?.aborted) {
      notify({
        type: 'TASK_COMPLETE',
        success: false,
        aborted: true,
        summary: '🛑 Task execution halted by Emergency Stop.'
      });
      return { success: false, aborted: true, summary: 'Task halted by Emergency Stop' };
    }

    notify({
      type: 'AGENT_THOUGHT',
      thought: 'Autonomous Engine: Analyzing browser context, active DOM, and local environment to formulate task plan.'
    });

    const planSteps = await provider.planTask(task, context);
    const stepResults = [];
    let taskFailed = false;
    let failureReason = '';

    for (let i = 0; i < planSteps.length; i++) {
      if (abortSignal?.aborted) {
        notify({
          type: 'TASK_COMPLETE',
          success: false,
          aborted: true,
          summary: '🛑 Task execution halted by Emergency Stop.'
        });
        return { success: false, aborted: true, summary: 'Task halted by Emergency Stop', steps: stepResults };
      }

      const step = planSteps[i];

      // Stream thought to UI
      notify({
        type: 'AGENT_THOUGHT',
        thought: step.thought
      });

      // Announce tool execution
      notify({
        type: 'TOOL_START',
        tool: step.tool,
        params: step.params
      });

      try {
        const res = await this.toolRegistry.execute(
          step.tool,
          step.params,
          (approvalReq) => {
            notify({
              type: 'APPROVAL_REQUEST',
              ...approvalReq
            });
          },
          abortSignal
        );

        notify({
          type: 'TOOL_FINISH',
          tool: step.tool,
          result: res.result
        });

        stepResults.push({
          tool: step.tool,
          params: step.params,
          result: res.result,
          success: true
        });
      } catch (err) {
        notify({
          type: 'TOOL_FINISH',
          tool: step.tool,
          error: err.message
        });

        stepResults.push({
          tool: step.tool,
          params: step.params,
          error: err.message,
          success: false
        });

        taskFailed = true;
        failureReason = err.message;
        break; // Stop on critical failure or denial
      }

      if (abortSignal?.aborted) {
        notify({
          type: 'TASK_COMPLETE',
          success: false,
          aborted: true,
          summary: '🛑 Task execution halted by Emergency Stop.'
        });
        return { success: false, aborted: true, summary: 'Task halted by Emergency Stop', steps: stepResults };
      }
    }

    if (taskFailed) {
      const isDenied = failureReason.toLowerCase().includes('denied');
      const failSummary = isDenied
        ? `🛑 Action denied: ${failureReason}`
        : `❌ Task failed at step: ${failureReason}`;

      notify({
        type: 'TASK_COMPLETE',
        success: false,
        summary: failSummary,
        steps: stepResults
      });
      return { success: false, summary: failSummary, steps: stepResults };
    }

    // Verify and synthesize response
    const summary = provider.synthesizeResponse(task, stepResults);
    notify({
      type: 'TASK_COMPLETE',
      success: true,
      summary,
      steps: stepResults
    });

    return { success: true, summary, steps: stepResults };
  }

  // --- LLM Multi-step ReAct Loop ---
  async runLlmReActLoop(task, context, provider, notify, abortSignal, policy, requestedProvider = 'hybrid', conversationId = null) {
    const isCloud = typeof provider.isLocal === 'boolean'
      ? !provider.isLocal
      : (typeof provider.isRemote === 'boolean'
          ? provider.isRemote
          : (provider.category ? provider.category === 'cloud' || provider.category === 'remote'
              : (provider.constructor.name !== 'OllamaProvider' && provider.constructor.name !== 'FallbackAgentProvider')));
    const activePolicy = policy || this.config.hybridRoutingPolicy || 'balanced';

    // Enforce Privacy-First at initial outbound boundary: Never transmit local tasks or visual context to cloud models
    if (activePolicy === 'privacy-first' && isCloud) {
      const router = new HybridRouter(this.config);
      const classification = router.classifyTask(task, context);
      if (classification.isLocalOperation || classification.isSensitive || classification.hasScreenshotVisual) {
        notify({
          type: 'PROVIDER_SWITCH',
          provider: 'autonomous',
          reason: 'Privacy-First Policy: Local workspace operation or visual context cannot be transmitted to cloud. Transferred to local Autonomous Engine.'
        });
        notify({
          type: 'AGENT_MESSAGE',
          message: '🔒 Privacy-First: Switched to Built-in Autonomous Engine to process local data securely without cloud transmission.'
        });
        const fallback = new FallbackAgentProvider(this.toolRegistry);
        return this.runAutonomousFallback(task, context, fallback, notify, abortSignal);
      }
    }

    const tools = this.toolRegistry.getToolDefinitions();
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `User Task: "${task}"\n\nCurrent Browser Context:\n${JSON.stringify(context, null, 2)}`
      }
    ];

    const maxSteps = 8;
    let currentStep = 0;

    notify({
      type: 'AGENT_THOUGHT',
      thought: `Connecting to ${provider.constructor.name}... Evaluating tool plan.`
    });

    while (currentStep < maxSteps) {
      if (abortSignal?.aborted) {
        notify({
          type: 'TASK_COMPLETE',
          success: false,
          aborted: true,
          summary: '🛑 Task execution halted by Emergency Stop.'
        });
        return { success: false, aborted: true, summary: 'Task halted by Emergency Stop' };
      }
      currentStep++;

      // Centralized Privacy Enforcement: Evaluate exact outbound payload & provenance immediately prior to cloud request
      const privacyCheck = this.privacyEnforcer.inspectOutboundPayload({
        messages,
        tools,
        context,
        activePolicy,
        provider,
        isManual: requestedProvider && requestedProvider !== 'hybrid',
        allowFallback: Boolean(this.config.allowFallbackOnMissingCredentials),
        bypassGuard: Boolean(this.config.bypassPrivacyGuardForTest),
        conversationId
      });

      if (!privacyCheck.allowed) {
        if (privacyCheck.action === 'divert') {
          notify({
            type: 'PROVIDER_SWITCH',
            provider: privacyCheck.targetProvider || 'autonomous',
            reason: privacyCheck.reason
          });
          notify({
            type: 'AGENT_MESSAGE',
            message: `🔒 ${privacyCheck.reason}`
          });
          const fallback = new FallbackAgentProvider(this.toolRegistry);
          return this.runAutonomousFallback(task, context, fallback, notify, abortSignal);
        }

        notify({
          type: 'TASK_COMPLETE',
          success: false,
          blocked: true,
          summary: `🛑 ${privacyCheck.error}`
        });
        return { success: false, blocked: true, summary: privacyCheck.error };
      }

      let stepDecision;
      try {
        stepDecision = await provider.generateStep(messages, tools);
      } catch (llmErr) {
        const fallbackAuth = this.canFallbackOnProviderError({
          requestedProvider,
          activePolicy,
          error: llmErr
        });

        if (!fallbackAuth.allowed) {
          notify({
            type: 'TASK_COMPLETE',
            success: false,
            error: llmErr.message,
            summary: `❌ ${fallbackAuth.reason}`
          });
          return { success: false, summary: fallbackAuth.reason, error: llmErr.message };
        }

        notify({
          type: 'PROVIDER_SWITCH',
          provider: fallbackAuth.targetProvider || 'autonomous',
          reason: fallbackAuth.reason
        });
        notify({
          type: 'AGENT_MESSAGE',
          message: `⚠️ ${fallbackAuth.reason}`
        });
        const fallback = new FallbackAgentProvider(this.toolRegistry);
        return this.runAutonomousFallback(task, context, fallback, notify, abortSignal);
      }

      if (abortSignal?.aborted) {
        notify({
          type: 'TASK_COMPLETE',
          success: false,
          aborted: true,
          summary: '🛑 Task execution halted by Emergency Stop.'
        });
        return { success: false, aborted: true, summary: 'Task halted by Emergency Stop' };
      }

      if (stepDecision.type === 'tool_call') {
        const { tool, params } = stepDecision;

        notify({
          type: 'AGENT_THOUGHT',
          thought: `Calling tool: ${tool}`
        });

        notify({
          type: 'TOOL_START',
          tool,
          params
        });

        try {
          const toolRes = await this.toolRegistry.execute(
            tool,
            params,
            (approvalReq) => {
              notify({
                type: 'APPROVAL_REQUEST',
                ...approvalReq
              });
            },
            abortSignal
          );

          notify({
            type: 'TOOL_FINISH',
            tool,
            result: toolRes.result
          });

          // Enforce Privacy-First rule at the exact boundary where local content could be sent to a cloud provider
          const localContentTools = [
            'read_file', 'search_files', 'list_files', 'file_info',
            'write_file', 'patch_file', 'delete_file', 'execute_command',
            'clipboard_read', 'clipboard_write', 'launch_application', 'get_system_info',
            'browser_screenshot'
          ];

          if (activePolicy === 'privacy-first' && localContentTools.includes(tool) && isCloud) {
            notify({
              type: 'PROVIDER_SWITCH',
              provider: 'autonomous',
              reason: `Privacy-First Policy: Local workspace content accessed via ${tool}. Execution transferred to local Autonomous Engine.`
            });
            notify({
              type: 'AGENT_MESSAGE',
              message: `🔒 Privacy-First: Switched to local Autonomous Engine to process local data securely without cloud transmission.`
            });
            const fallback = new FallbackAgentProvider(this.toolRegistry);
            return this.runAutonomousFallback(task, context, fallback, notify, abortSignal);
          }

          // Append observation to conversation history
          messages.push({
            role: 'assistant',
            content: `Called tool ${tool} with parameters: ${JSON.stringify(params)}`
          });
          messages.push({
            role: 'user',
            content: `Observation from ${tool}:\n${JSON.stringify(toolRes.result)}`
          });
        } catch (toolErr) {
          notify({
            type: 'TOOL_FINISH',
            tool,
            error: toolErr.message
          });

          if (abortSignal?.aborted) {
            notify({
              type: 'TASK_COMPLETE',
              success: false,
              aborted: true,
              summary: '🛑 Task execution halted by Emergency Stop.'
            });
            return { success: false, aborted: true, summary: 'Task halted by Emergency Stop' };
          }

          // If action was denied by user, stop loop
          if (toolErr.message.toLowerCase().includes('denied')) {
            const deniedSummary = `🛑 Task stopped: ${toolErr.message}`;
            notify({
              type: 'TASK_COMPLETE',
              success: false,
              summary: deniedSummary
            });
            return { success: false, summary: deniedSummary };
          }

          // Under Privacy-First, do NOT leak local tool errors to cloud model
          const localContentTools = [
            'read_file', 'search_files', 'list_files', 'file_info',
            'write_file', 'patch_file', 'delete_file', 'execute_command',
            'clipboard_read', 'clipboard_write', 'launch_application', 'get_system_info',
            'browser_screenshot'
          ];
          if (activePolicy === 'privacy-first' && localContentTools.includes(tool) && isCloud) {
            notify({
              type: 'PROVIDER_SWITCH',
              provider: 'autonomous',
              reason: `Privacy-First Policy: Error during local tool execution (${tool}). Transferring to Autonomous Engine.`
            });
            const fallback = new FallbackAgentProvider(this.toolRegistry);
            return this.runAutonomousFallback(task, context, fallback, notify, abortSignal);
          }

          messages.push({
            role: 'user',
            content: `Error executing ${tool}: ${toolErr.message}`
          });
        }
      } else {
        // Final verified message from model
        notify({
          type: 'TASK_COMPLETE',
          success: true,
          summary: stepDecision.content
        });
        return { success: true, summary: stepDecision.content };
      }
    }

    const boundSummary = 'Task reached maximum reasoning iterations (8 steps).';
    notify({ type: 'TASK_COMPLETE', success: false, summary: boundSummary });
    return { success: false, summary: boundSummary };
  }
}

module.exports = AgentOrchestrator;
