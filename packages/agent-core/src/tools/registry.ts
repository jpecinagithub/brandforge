/**
 * Registry of the 13 Phase 3 agent tools. `get` throws ToolNotFoundError for
 * unknown names so typos in plans fail loudly instead of silently.
 */
import type { ToolName } from '@brandforge/shared';
import type { AgentTool, ToolRegistry } from '../types.js';

export type { ToolRegistry };

export class ToolNotFoundError extends Error {
  readonly toolName: string;

  constructor(name: string) {
    super(`Unknown tool: ${name}`);
    this.name = 'ToolNotFoundError';
    this.toolName = name;
  }
}

export function createToolRegistry(tools: AgentTool[]): ToolRegistry {
  const map = new Map<ToolName, AgentTool>();
  for (const tool of tools) {
    if (map.has(tool.name)) {
      throw new Error(`Duplicate tool registration: ${tool.name}`);
    }
    map.set(tool.name, tool);
  }
  return {
    get(name: ToolName): AgentTool {
      const tool = map.get(name);
      if (!tool) {
        throw new ToolNotFoundError(name);
      }
      return tool;
    },
    list(): AgentTool[] {
      return [...map.values()];
    },
    names(): ToolName[] {
      return [...map.keys()];
    },
  };
}
