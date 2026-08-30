/**
 * DOM events shared between renderer and content services must be scoped to the
 * current extension installation. Multiple installed copies otherwise listen on
 * the same page-level document event and can inject the same tool result twice.
 */
const runtimeId =
  typeof chrome !== 'undefined' && chrome.runtime?.id
    ? chrome.runtime.id
    : 'local-runtime';

export const TOOL_EXECUTION_COMPLETE_EVENT = `mcp:tool-execution-complete:${runtimeId}`;