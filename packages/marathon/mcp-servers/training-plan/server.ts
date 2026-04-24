#!/usr/bin/env tsx
/**
 * Marathon `training-plan` MCP server. Stdio transport — invoked as a subprocess
 * by the agent session that the platform spawns. Exposes four tools the agent
 * uses to read state and apply mechanical changes.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  FlagOvertrainingInput,
  GetPlanInput,
  QueryHistoryInput,
  UpdateWorkoutInput,
  flagOvertraining,
  getPlan,
  queryHistory,
  updateWorkout,
} from './tools.js';

async function main(): Promise<void> {
  const server = new McpServer({
    name: 'marathon-training-plan',
    version: '0.1.0',
  });

  server.registerTool(
    'get_plan',
    {
      description: 'Return the active training plan, week-blocks, and workouts.',
      inputSchema: GetPlanInput.shape,
    },
    async () => {
      const plan = await getPlan();
      return { content: [{ type: 'text', text: JSON.stringify(plan) }] };
    },
  );

  server.registerTool(
    'update_workout',
    {
      description:
        'Apply a structural patch to a single workout (target duration, target pace, kind, completed, notes).',
      inputSchema: UpdateWorkoutInput.shape,
    },
    async (input) => {
      const result = await updateWorkout(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'query_history',
    {
      description:
        'Read-only SQL query against the platform data store. SELECT / WITH only; results are capped.',
      inputSchema: QueryHistoryInput.shape,
    },
    async (input) => {
      const rows = await queryHistory(input);
      return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
    },
  );

  server.registerTool(
    'flag_overtraining',
    {
      description:
        'Raise a structured flag when training-load patterns suggest overreach. Captures the reason; no side effects on the plan itself.',
      inputSchema: FlagOvertrainingInput.shape,
    },
    async (input) => {
      const result = await flagOvertraining(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('[mcp:training-plan] fatal', err);
  process.exit(1);
});
