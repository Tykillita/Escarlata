export type ToolInputType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface ToolParameter {
  name: string;
  type: ToolInputType;
  description: string;
  required?: boolean;
  /** Allowed values for string params; enforced by validateToolInput */
  enum?: string[];
}

/**
 * Validate (and coerce in place) a tool input against its definition.
 * Returns an error string for the model, or null if the input is valid.
 * Coercions: numeric strings -> number, "true"/"false" -> boolean.
 * Unknown extra params are ignored (models often add them).
 */
export function validateToolInput(
  def: ToolDefinition,
  input: Record<string, unknown>
): string | null {
  const problems: string[] = [];

  for (const p of def.parameters) {
    const value = input[p.name];
    const missing = value === undefined || value === null ||
      (typeof value === 'string' && value.trim() === '');

    if (missing) {
      if (p.required) problems.push(`falta el parámetro requerido "${p.name}" (${p.type}): ${p.description}`);
      continue;
    }

    switch (p.type) {
      case 'number':
        if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
          input[p.name] = Number(value);
        } else if (typeof value !== 'number') {
          problems.push(`"${p.name}" debe ser un número, recibí ${JSON.stringify(value)}`);
        }
        break;
      case 'boolean':
        if (value === 'true') input[p.name] = true;
        else if (value === 'false') input[p.name] = false;
        else if (typeof value !== 'boolean') {
          problems.push(`"${p.name}" debe ser booleano, recibí ${JSON.stringify(value)}`);
        }
        break;
      case 'string':
        if (typeof value !== 'string') {
          input[p.name] = String(value);
        }
        if (p.enum && !p.enum.includes(String(input[p.name]))) {
          problems.push(`"${p.name}" debe ser uno de: ${p.enum.join(', ')}`);
        }
        break;
      case 'array':
        if (!Array.isArray(value)) problems.push(`"${p.name}" debe ser un array`);
        break;
      case 'object':
        if (typeof value !== 'object' || Array.isArray(value)) problems.push(`"${p.name}" debe ser un objeto`);
        break;
    }
  }

  if (problems.length === 0) return null;
  const paramList = def.parameters
    .map(p => `${p.name} (${p.type}${p.required ? ', requerido' : ''})`)
    .join(', ');
  return `Error de validación en "${def.name}": ${problems.join('; ')}. Parámetros esperados: ${paramList || 'ninguno'}. Corrige la llamada y reintenta.`;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  /** If true, action requires user confirmation before running (Tier 6) */
  requiresConfirmation?: boolean;
  /** Stable policy key used by every surface (e.g. delete_data, modify_calendar). */
  safetyAction?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  success: boolean;
  output: string;
}

export interface Tool {
  definition: ToolDefinition;
  handler: (input: Record<string, unknown>) => Promise<string>;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool): void {
    if (this.tools.has(tool.definition.name)) {
      throw new Error(`Tool "${tool.definition.name}" already registered`);
    }
    this.tools.set(tool.definition.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map(t => t.definition);
  }

  has(name: string): boolean { return this.tools.has(name); }
}
