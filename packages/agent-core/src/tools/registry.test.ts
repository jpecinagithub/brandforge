import { describe, expect, it } from 'vitest';
import { TOOL_NAMES } from '@brandforge/shared';
import {
  allTools,
  createDefaultRegistry,
  createToolRegistry,
  ToolNotFoundError,
} from './index.js';

describe('tool registry', () => {
  it('registers exactly the 13 Phase 3 tools', () => {
    const registry = createDefaultRegistry();
    expect(registry.names().sort()).toEqual([...TOOL_NAMES].sort());
    expect(registry.list()).toHaveLength(13);
    expect(allTools).toHaveLength(13);
  });

  it('get returns the tool for a known name', () => {
    const registry = createDefaultRegistry();
    expect(registry.get('generate_image').category).toBe('generate');
    expect(registry.get('create_campaign').category).toBe('write');
    expect(registry.get('list_project_assets').category).toBe('read');
  });

  it('get throws ToolNotFoundError for an unknown name', () => {
    const registry = createDefaultRegistry();
    expect(() => registry.get('does_not_exist' as never)).toThrow(
      ToolNotFoundError,
    );
  });

  it('rejects duplicate tool registration', () => {
    expect(() => createToolRegistry([allTools[0], allTools[0]])).toThrow(
      /Duplicate tool registration/,
    );
  });

  it('every tool has a description, a zod schema and a numeric estimate', () => {
    for (const tool of allTools) {
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.schema).toBeDefined();
      expect(typeof tool.schema.safeParse).toBe('function');
      const estimate = tool.estimateUsd({});
      expect(typeof estimate).toBe('number');
      expect(estimate).toBeGreaterThanOrEqual(0);
    }
  });
});
