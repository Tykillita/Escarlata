import { ToolRegistry } from './registry.js';
import { saveNoteTool, getNoteTool, listNotesTool, searchNotesTool } from './notes.js';
import { getTodayTool, getWeekTool, upcomingEventsTool, addEventTool } from './calendar.js';
import { webSearchTool, readLocalFileTool, editLocalFileTool } from './search.js';
import { registerMemoryTools } from '../memory/tools.js';
import { setReminderTool, listRemindersTool, cancelReminderTool } from './reminders.js';
import { getDirectivesTool, addTodoTool, doneTodoTool } from './directives.js';
import { listConversationsTool, readConversationTool } from './conversations.js';
import { firebaseCollectionsTool, firebaseQueryTool, firebaseGetDocTool } from './firebase.js';

export function registerAllTools(registry: ToolRegistry): void {
  registry.register(saveNoteTool);
  registry.register(getNoteTool);
  registry.register(listNotesTool);
  registry.register(searchNotesTool);
  registry.register(getTodayTool);
  registry.register(getWeekTool);
  registry.register(upcomingEventsTool);
  registry.register(addEventTool);
  registry.register(webSearchTool);
  registry.register(readLocalFileTool);
  registry.register(editLocalFileTool);
  registerMemoryTools(registry);
  registry.register(setReminderTool);
  registry.register(listRemindersTool);
  registry.register(cancelReminderTool);
  registry.register(listConversationsTool);
  registry.register(readConversationTool);
  registry.register(firebaseCollectionsTool);
  registry.register(firebaseQueryTool);
  registry.register(firebaseGetDocTool);
  registry.register(getDirectivesTool);
  registry.register(addTodoTool);
  registry.register(doneTodoTool);
}

export { ToolRegistry } from './registry.js';