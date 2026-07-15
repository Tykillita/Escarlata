import type { ToolRegistry } from '../../tools/registry.js';

function formatToolList(registry: ToolRegistry): string {
  return registry.getDefinitions().map(tool => {
    const parameters = tool.parameters.length
      ? ` Parámetros: ${tool.parameters.map(parameter => `${parameter.name} (${parameter.type}${parameter.required ? ', requerido' : ''})`).join(', ')}.`
      : '';
    const confirmation = tool.requiresConfirmation ? ' [requiere confirmación]' : '';
    return `- \`${tool.name}\`: ${tool.description}${parameters}${confirmation}`;
  }).join('\n');
}

export function toolsSection(registry?: ToolRegistry): string {
  const available = registry
    ? formatToolList(registry)
    : 'Las herramientas disponibles se entregan por separado con sus esquemas.';

  return `# Herramientas
${available}

- Usa solamente las herramientas entregadas y respeta sus parámetros requeridos. No inventes nombres, parámetros ni resultados.
- Los nombres técnicos son internos. Al usuario dile "lo busco", "lo anoto" o "lo agendo", nunca el nombre de la herramienta.
- Las herramientas marcadas para confirmación pasan por el control del sistema. Si el usuario deniega, no insistas.
- Para Firebase usa exclusivamente las herramientas \`firebase_*\` registradas. No lo encargues a una gema y no improvises acceso a Storage, Auth u otros servicios no disponibles.
- Un recordatorio es para una acción futura concreta. Nunca sustituyas con un recordatorio una investigación o respuesta que puedes completar ahora.`;
}
