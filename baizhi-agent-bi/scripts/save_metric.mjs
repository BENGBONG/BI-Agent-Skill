#!/usr/bin/env node
import { saveMetricDefinition } from "./lib/operations.mjs";
import { parseArgs, resolveWorkspacePath } from "./lib/workspace.mjs";

const args = parseArgs();
const workspacePath = resolveWorkspacePath();
const id = args.id;

if (!id) {
  console.error("Missing --id <metric_id>");
  process.exit(1);
}

const result = saveMetricDefinition({
  id,
  name: args.name,
  status: args.status || "draft",
  description: args.description,
  definition: args.definition,
  grain: args.grain,
  timeField: args["time-field"],
  timeDescription: args["time-description"],
  numeratorName: args.numerator,
  numeratorLogic: args["numerator-logic"],
  denominatorName: args.denominator,
  denominatorLogic: args["denominator-logic"],
  actualSql: args["actual-sql"],
  validatedBy: args["validated-by"],
  confirmValidated: Boolean(args["confirm-validated"]),
  notes: args.note ? [args.note] : undefined
}, workspacePath);

console.log(JSON.stringify({ ok: true, ...result }, null, 2));
