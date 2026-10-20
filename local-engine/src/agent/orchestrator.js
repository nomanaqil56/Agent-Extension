// Antigravity Local Agent Engine - ReAct Agent Orchestrator

const { createProvider, HybridRouter, FallbackAgentProvider } = require('./providers');
const { SYSTEM_PROMPT } = require('./prompts');

class AgentOrchestrator {
  constructor(toolRegistry, memoryManager, config = {}) {
    this.toolRegistry = toolRegistry;
    this.memoryManager = memoryManager;
    this.config = config;
  }

  // Execute full agent task pipeline
  async runTask({ task, providerName = 'hybrid', context = {}, clientWs = null, abortSignal = null }) {
    console.log(`\n[Agent Orchestrator] Starting task: "${task}" (Requested: ${providerName})`);

    const notify = (msg) => {
      if (clientWs && clientWs.readyState === 1) { // 1 = OPEN
        try {
          clientWs.send(JSON.stringify(msg));
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
    const { provider, activeProviderName, isFallback, fallbackReason, policy, model, reason } = routed;

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
    return this.runLlmReActLoop(task, context, provider, notify, abortSignal);
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
  async runLlmReActLoop(task, context, provider, notify, abortSignal) {
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

      let stepDecision;
      try {
        stepDecision = await provider.generateStep(messages, tools);
      } catch (llmErr) {
        notify({
          type: 'PROVIDER_SWITCH',
          provider: 'autonomous',
          reason: `LLM Error (${provider.constructor.name}): ${llmErr.message}. Switching to Built-in Autonomous Engine.`
        });
        notify({
          type: 'AGENT_MESSAGE',
          message: `⚠️ Provider Error: ${llmErr.message}. Continuing with Built-in Autonomous Engine.`
        });
        // Gracefully fall back to built-in autonomous engine
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
