// Antigravity Local Agent Engine - Deterministic Diagnostic Helper (Offline Zero-Config Utility)
// Provides basic scripted diagnostic inspection when no AI model or external API key is configured.
// NOTE: This helper is NOT a general-purpose LLM and does not perform autonomous reasoning.

class FallbackAgentProvider {
  constructor(toolRegistry) {
    this.name = 'deterministic-helper';
    this.model = 'deterministic-rules';
    this.isLocal = true;
    this.isRemote = false;
    this.category = 'local';
    this.supportsTools = true;
    this.supportsStreaming = false;
    this.toolRegistry = toolRegistry;
  }

  async checkHealth() {
    return {
      healthy: true,
      provider: 'deterministic-helper',
      engine: 'deterministic-diagnostic-helper',
      toolsCount: this.toolRegistry?.tools?.size || 0
    };
  }

  // Generate a multi-step plan based on natural language task and browser context
  async planTask(task, context = {}) {
    const lower = task.toLowerCase();
    const steps = [];

    // 1. Webpage extraction & summarization
    if (lower.includes('summarize') || lower.includes('summary')) {
      steps.push({
        thought: 'Extracting main content and headings from the active browser page to generate an executive summary.',
        tool: 'browser_extract_text',
        params: {}
      });
    }

    // 2. Interactive buttons labeling
    else if (lower.includes('label') || lower.includes('highlight') || (lower.includes('button') && !lower.includes('click'))) {
      steps.push({
        thought: 'Distilling interactive DOM elements and overlaying visual labels [1], [2], [3] on buttons and links.',
        tool: 'browser_distill_dom',
        params: { maxElements: 60 }
      });
    }

    // 3. Browser element click
    else if (lower.includes('click')) {
      const match = task.match(/click\s+(?:on\s+)?(?:the\s+)?(["']?)(.*?)\1(?:\s+button|\s+link|$)/i);
      const target = match ? match[2].trim() : task.replace(/click/i, '').trim();
      steps.push({
        thought: `Locating and clicking element matching "${target}" with visual highlight feedback.`,
        tool: 'browser_click',
        params: { target }
      });
    }

    // 4. Fill form / type text
    else if (lower.includes('type') || lower.includes('fill') || lower.includes('enter')) {
      const targetMatch = task.match(/(?:in|into|field|input)\s+([^,]+)/i);
      const valueMatch = task.match(/(?:type|fill|enter)\s+["']?([^"']+)["']?/i);
      const target = targetMatch ? targetMatch[1].trim() : 'input';
      const value = valueMatch ? valueMatch[1].trim() : 'Sample text';
      steps.push({
        thought: `Filling input "${target}" with value and triggering DOM change events.`,
        tool: 'browser_fill',
        params: { target, value, pressEnter: lower.includes('search') || lower.includes('submit') }
      });
    }

    // 5. Open website / navigate
    else if (lower.includes('go to') || lower.includes('open') || lower.includes('navigate')) {
      const urlMatch = task.match(/(?:go to|open|navigate to)\s+([a-zA-Z0-9\-\.\/\:]+)/i);
      if (urlMatch && (urlMatch[1].includes('.') || urlMatch[1].startsWith('http'))) {
        const url = urlMatch[1];
        steps.push({
          thought: `Navigating browser to destination URL: ${url}`,
          tool: 'browser_navigate',
          params: { url }
        });
      }
    }

    // 6. Screenshot
    else if (lower.includes('screenshot') || lower.includes('capture')) {
      steps.push({
        thought: 'Capturing high-resolution visual screenshot of current browser viewport.',
        tool: 'browser_screenshot',
        params: {}
      });
    }

    // 7. Local Project Files: List or search
    else if (lower.includes('list file') || lower.includes('check project') || lower.includes('project files') || lower.includes('show files')) {
      steps.push({
        thought: 'Scanning approved project directories to inspect project structure and files.',
        tool: 'list_files',
        params: { dirPath: '.', recursive: false }
      });
    }

    // 8. Terminal / Tests / Commands
    else if (lower.includes('test') || lower.includes('git status') || lower.includes('terminal') || lower.includes('run command') || lower.includes('npm')) {
      let command = 'git status';
      if (lower.includes('npm test') || lower.includes('run test')) command = 'npm test';
      else if (lower.includes('npm run') || lower.includes('build')) command = 'npm run build';
      else if (lower.includes('dir') || lower.includes('ls')) command = process.platform === 'win32' ? 'dir' : 'ls -la';
      else {
        const cmdMatch = task.match(/run\s+`?([^`]+)`?/i);
        if (cmdMatch) command = cmdMatch[1].trim();
      }

      steps.push({
        thought: `Executing command \`${command}\` in controlled terminal environment with process monitoring.`,
        tool: 'execute_command',
        params: { command }
      });
    }

    // 9. System Info
    else if (lower.includes('system') || lower.includes('cpu') || lower.includes('memory') || lower.includes('telemetry')) {
      steps.push({
        thought: 'Querying host operating system telemetry, CPU, memory, and uptime.',
        tool: 'get_system_info',
        params: {}
      });
    }

    // 10. Default composite: inspect page DOM and check files
    else {
      steps.push({
        thought: 'Inspecting active page context and interactive DOM structure to understand current state.',
        tool: 'browser_distill_dom',
        params: { maxElements: 40 }
      });
    }

    return steps;
  }

  // Synthesize executive response from execution observations
  synthesizeResponse(task, planResults) {
    let summary = `### ⚡ Task Completed\n\n**Goal**: "${task}"\n\n`;

    planResults.forEach((step, idx) => {
      summary += `**Step ${idx + 1} (${step.tool})**:\n`;
      if (step.tool === 'browser_extract_text') {
        const lines = (step.result?.content || '').split('\n').filter(l => l.length > 20).slice(0, 6);
        summary += `Extracted page title: **${step.result?.title || 'Unknown'}**\n`;
        summary += lines.map(l => `> ${l}`).join('\n') + '\n\n';
      } else if (step.tool === 'browser_distill_dom') {
        summary += `Identified **${step.result?.totalCount || 0}** interactive elements on current page.\n\n`;
      } else if (step.tool === 'execute_command') {
        summary += `Command \`${step.params.command}\` exited with code **${step.result?.exitCode}**:\n\`\`\`\n${(step.result?.stdout || step.result?.stderr || '(No output)').slice(0, 600)}\n\`\`\`\n\n`;
      } else if (step.tool === 'list_files') {
        summary += `Found **${step.result?.totalEntries || 0}** entries in \`${step.result?.baseDir}\`:\n` +
          (step.result?.entries || []).slice(0, 8).map(e => `- [${e.type}] \`${e.name}\``).join('\n') + '\n\n';
      } else if (step.tool === 'get_system_info') {
        const sys = step.result;
        summary += `Host: **${sys.platform} (${sys.arch})** | CPUs: **${sys.cpus}** | RAM: **${sys.memory?.usedGb}GB / ${sys.memory?.totalGb}GB (${sys.memory?.usagePercent}%)**\n\n`;
      } else {
        summary += `Result: \`${JSON.stringify(step.result).slice(0, 300)}\`\n\n`;
      }
    });

    summary += `\n*(Executed via offline deterministic helper. For full adaptive autonomous reasoning and dynamic tool calling, configure an AI model in Settings.)*`;

    return summary;
  }
}

module.exports = FallbackAgentProvider;
