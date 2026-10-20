// Antigravity Local Agent Engine - ReAct Agent Orchestrator

const { createProvider, FallbackAgentProvider } = require('./providers');
const { SYSTEM_PROMPT } = require('./prompts');

class AgentOrchestrator {
  constructor(toolRegistry, memoryManager, config = {}) {
    this.toolRegistry = toolRegistry;
    this.memoryManager = memoryManager;
    this.config = config;
  }

  // Execute full agent task pipeline
  async runTask({ task, providerName = 'fallback', context = {}, clientWs = null, abortSignal = null }) {
    console.log(`\n[Agent Orchestrator] Starting task: "${task}" (Provider: ${providerName})`);

    const notify = (msg) => {
      if (clientWs && clientWs.readyState === 1) { // 1 = OPEN
        clientWs.send(JSON.stringify(msg));
      }
    };

    const provider = createProvider(providerName, this.config, this.toolRegistry);

    // If using autonomous fallback provider
    if (provider instanceof FallbackAgentProvider) {
      return this.runAutonomousFallback(task, context, provider, notify, abortSignal);
    }

    // Otherwise run iterative ReAct loop with selected LLM
    return this.runLlmReActLoop(task, context, provider, notify, abortSignal);
  }

  // --- Autonomous Engine Execution ---
  async runAutonomousFallback(task, context, provider, notify, abortSignal) {
    notify({
      type: 'AGENT_THOUGHT',
      thought: 'Autonomous Engine: Analyzing browser context, active DOM, and local environment to formulate task plan.'
    });

    const planSteps = await provider.planTask(task, context);
    const stepResults = [];

    for (let i = 0; i < planSteps.length; i++) {
      if (abortSignal?.aborted) {
        throw new Error('Task was halted by Emergency Stop.');
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
          }
        );

        notify({
          type: 'TOOL_FINISH',
          tool: step.tool,
          result: res.result
        });

        stepResults.push({
          tool: step.tool,
          params: step.params,
          result: res.result
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
          error: err.message
        });
        break; // Stop on critical failure
      }
    }

    const summary = provider.synthesizeResponse(task, stepResults);
    notify({
      type: 'TASK_COMPLETE',
      summary
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
        throw new Error('Task was halted by Emergency Stop.');
      }
      currentStep++;

      let stepDecision;
      try {
        stepDecision = await provider.generateStep(messages, tools);
      } catch (llmErr) {
        notify({
          type: 'AGENT_MESSAGE',
          message: `⚠️ LLM Error: ${llmErr.message}. Switching to Autonomous Engine fallback.`
        });
        // Gracefully fall back to built-in autonomous engine
        const fallback = new FallbackAgentProvider(this.toolRegistry);
        return this.runAutonomousFallback(task, context, fallback, notify, abortSignal);
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
            }
          );

          notify({
            type: 'TOOL_FINISH',
            tool,
            result: toolRes.result
          });

          // Append to conversation
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
          messages.push({
            role: 'user',
            content: `Error executing ${tool}: ${toolErr.message}`
          });
        }
      } else {
        // Final message
        notify({
          type: 'TASK_COMPLETE',
          summary: stepDecision.content
        });
        return { success: true, summary: stepDecision.content };
      }
    }

    const fallbackSummary = 'Task reached maximum reasoning iterations.';
    notify({ type: 'TASK_COMPLETE', summary: fallbackSummary });
    return { success: true, summary: fallbackSummary };
  }
}

module.exports = AgentOrchestrator;
