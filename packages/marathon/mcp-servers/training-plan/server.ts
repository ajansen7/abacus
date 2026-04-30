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
  CreateRaceInput,
  createRace,
  UpdatePlanMetaInput,
  updatePlanMeta,
  CreateWeekBlockInput,
  createWeekBlock,
  CreateWorkoutInput,
  createWorkout,
  SetWorkoutActualInput,
  setWorkoutActual,
  ClearWorkoutActualInput,
  clearWorkoutActual,
  ReadPlanContextInput,
  readPlanContext,
  ListTemplatesInput,
  listTemplates,
  ReadTemplateInput,
  readTemplate,
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
        'Apply a structural patch to a single workout (date to reschedule, target duration, target pace, kind, completed, notes).',
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

  server.registerTool(
    'create_race',
    {
      description: 'Create a marathon:race entity for a target event.',
      inputSchema: CreateRaceInput.shape,
    },
    async (input) => {
      const result = await createRace(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'update_plan_meta',
    {
      description: 'Patch metadata on an existing marathon:training-plan (e.g., set goalPace after generation).',
      inputSchema: UpdatePlanMetaInput.shape,
    },
    async (input) => {
      const result = await updatePlanMeta(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'create_week_block',
    {
      description: 'Create a marathon:week-block scoped to a plan.',
      inputSchema: CreateWeekBlockInput.shape,
    },
    async (input) => {
      const result = await createWeekBlock(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'create_workout',
    {
      description: 'Create a marathon:workout inside a week-block.',
      inputSchema: CreateWorkoutInput.shape,
    },
    async (input) => {
      const result = await createWorkout(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'set_workout_actual',
    {
      description: 'Record what was actually done for a planned workout (met, partial, swapped, skipped, or extra).',
      inputSchema: SetWorkoutActualInput.shape,
    },
    async (input) => {
      const result = await setWorkoutActual(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'clear_workout_actual',
    {
      description:
        'Clear the actual completion record from a workout, resetting completed to false. Use to fix incorrectly matched or phantom completions.',
      inputSchema: ClearWorkoutActualInput.shape,
    },
    async (input) => {
      const result = await clearWorkoutActual(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'read_plan_context',
    {
      description: 'Return the marathon:plan-context (free-form steering notes) for the active plan.',
      inputSchema: ReadPlanContextInput.shape,
    },
    async (input) => {
      const result = await readPlanContext(input);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'list_templates',
    {
      description: 'List available plan template names (.md files in templates/plans/).',
      inputSchema: ListTemplatesInput.shape,
    },
    async () => {
      const result = await listTemplates();
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    },
  );

  server.registerTool(
    'read_template',
    {
      description: 'Read a plan template by name. Pass the filename or just the base name (couch-to-marathon).',
      inputSchema: ReadTemplateInput.shape,
    },
    async (input) => {
      const result = await readTemplate(input);
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
